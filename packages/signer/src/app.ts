import { Hono } from "hono";
import { getAddress } from "viem";
import { loadKeystore, type AgentEntry, type Policy, type TypedDataRule } from "./keystore.js";

const BIGINT_TX_FIELDS = ["value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "maxFeePerBlobGas"] as const;

/** Rebuild a viem-signable tx from JSON transport (hex-string bigints -> bigint). */
function reviveTx(input: Record<string, unknown>): Record<string, unknown> {
  const tx: Record<string, unknown> = { ...input };
  for (const f of BIGINT_TX_FIELDS) if (tx[f] != null) tx[f] = BigInt(tx[f] as string);
  if (tx.nonce != null) tx.nonce = Number(tx.nonce);
  if (tx.chainId != null) tx.chainId = Number(tx.chainId);
  return tx;
}

/** Message fields typed as uintN/intN arrive as hex strings; restore them to bigint. */
function coerceTypedData(td: { types?: Record<string, Array<{ name: string; type: string }>>; primaryType?: string; message?: Record<string, unknown> }) {
  const fields = (td.types?.[td.primaryType ?? ""] as Array<{ name: string; type: string }>) ?? [];
  const message: Record<string, unknown> = { ...(td.message ?? {}) };
  for (const f of fields) {
    if (/^u?int\d*$/.test(f.type) && message[f.name] != null && typeof message[f.name] !== "bigint") {
      message[f.name] = BigInt(message[f.name] as string | number);
    }
  }
  return { ...td, message };
}

function checkPolicy(policy: Policy | undefined, tx: Record<string, unknown>): string | null {
  if (!policy) return null;
  if (policy.allowChains && tx.chainId != null && !policy.allowChains.includes(Number(tx.chainId)))
    return `chain ${tx.chainId} not allowed`;
  if (policy.maxValueWei != null && tx.value != null && BigInt(tx.value as bigint) > BigInt(policy.maxValueWei))
    return `value exceeds cap (${policy.maxValueWei})`;
  if (policy.allowTo && tx.to != null) {
    const to = String(tx.to).toLowerCase();
    if (!policy.allowTo.map((a) => a.toLowerCase()).includes(to)) return `recipient ${tx.to} not allowlisted`;
  }
  return null;
}

// Default-on: typed-data signing is used for FuelVault gifting (swaps use on-chain
// approve, SIWE uses sign/message) and for claiming a token listing (proving on-chain
// creator ownership to attach off-chain metadata; moves no funds). So with no explicit
// policy we allow ONLY those two and reject everything else, which blocks the real
// risk, an arbitrary Permit2/EIP-2612 drain permit. Matched on domain name+version, so
// it's address/redeploy-agnostic. An explicit allowTypedData in the keystore overrides.
const DEFAULT_TYPED_DATA_ALLOWLIST: TypedDataRule[] = [
  { primaryType: "GiftPermit", name: "FuelVault", version: "1" },
  { primaryType: "ClaimListing", name: "Kumbaya Token Claim", version: "1" },
];

/** Gate /v1/sign/typed-data. A signed permit authorizes a token move, so the request
 *  must match one allowlist rule (every set field). Falls back to the FuelVault
 *  GiftPermit default when a keystore entry sets no explicit allowTypedData. */
function checkTypedDataPolicy(policy: Policy | undefined, td: Record<string, unknown>): string | null {
  const rules = policy?.allowTypedData ?? DEFAULT_TYPED_DATA_ALLOWLIST;
  const domain = (td.domain ?? {}) as Record<string, unknown>;
  const message = (td.message ?? {}) as Record<string, unknown>;
  const name = String(domain.name ?? "");
  const version = String(domain.version ?? "");
  const vc = String(domain.verifyingContract ?? "").toLowerCase();
  const cid = domain.chainId != null ? Number(domain.chainId) : undefined;
  const primaryType = String(td.primaryType ?? "");
  const matched = rules.some((r) => {
    if (r.primaryType && r.primaryType !== primaryType) return false;
    if (r.name && r.name !== name) return false;
    if (r.version && r.version !== version) return false;
    if (r.verifyingContract && r.verifyingContract.toLowerCase() !== vc) return false;
    if (r.chainId != null && r.chainId !== cid) return false;
    if (r.spenderField) {
      const spender = String(message[r.spenderField] ?? "").toLowerCase();
      if (!(r.allowSpenders ?? []).map((s) => s.toLowerCase()).includes(spender)) return false;
    }
    return true;
  });
  return matched ? null : `typed-data not allowlisted (primaryType=${primaryType || "?"}, domain=${name || "?"}/${version || "?"})`;
}

function shortAddr(a?: unknown): string {
  const s = typeof a === "string" ? a : "";
  return s.length >= 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s || "?";
}

/** One console line per signing request so a relayed tx can be traced to the agent
 *  it came from. stderr only (no persistence); Railway captures it in the log stream. */
function logSign(kind: string, entry: AgentEntry | null, detail: string, outcome: string): void {
  const who = entry ? `agent=${entry.label ?? shortAddr(entry.account.address)} addr=${shortAddr(entry.account.address)}` : "agent=UNAUTHORIZED";
  console.error(`[signer] ${kind} ${who}${detail ? " " + detail : ""} -> ${outcome}`);
}

export function createApp(keystore = loadKeystore()) {
  const app = new Hono();

  const auth = (c: { req: { header: (n: string) => string | undefined } }): AgentEntry | null => {
    const header = c.req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : header;
    return (token && keystore.get(token)) || null;
  };

  app.get("/health", (c) => c.json({ ok: true, agents: keystore.size }));

  app.get("/v1/address", (c) => {
    const entry = auth(c);
    if (!entry) return c.json({ error: "unauthorized" }, 401);
    return c.json({ address: entry.account.address, label: entry.label });
  });

  app.post("/v1/sign/transaction", async (c) => {
    const entry = auth(c);
    if (!entry) return (logSign("sign/transaction", null, "", "401 unauthorized"), c.json({ error: "unauthorized" }, 401));
    const { transaction } = (await c.req.json()) as { transaction: Record<string, unknown> };
    const tx = reviveTx(transaction);
    const detail = `to=${shortAddr(tx.to)} chainId=${tx.chainId ?? "?"} value=${tx.value ?? 0} nonce=${tx.nonce ?? "?"}`;
    const denied = checkPolicy(entry.policy, tx);
    if (denied) return (logSign("sign/transaction", entry, detail, `DENIED policy: ${denied}`), c.json({ error: `policy: ${denied}` }, 403));
    if (!entry.account.signTransaction) return (logSign("sign/transaction", entry, detail, "500 cannot sign"), c.json({ error: "account cannot sign transactions" }, 500));
    const signedTransaction = await entry.account.signTransaction(tx as never);
    logSign("sign/transaction", entry, detail, "signed");
    return c.json({ signedTransaction });
  });

  app.post("/v1/sign/typed-data", async (c) => {
    const entry = auth(c);
    if (!entry) return (logSign("sign/typed-data", null, "", "401 unauthorized"), c.json({ error: "unauthorized" }, 401));
    const { typedData } = (await c.req.json()) as { typedData: Record<string, unknown> };
    const domain = (typedData.domain ?? {}) as Record<string, unknown>;
    const detail = `primaryType=${typedData.primaryType ?? "?"} domain=${domain.name ?? "?"}`;
    const denied = checkTypedDataPolicy(entry.policy, typedData);
    if (denied) return (logSign("sign/typed-data", entry, detail, `DENIED policy: ${denied}`), c.json({ error: `policy: ${denied}` }, 403));
    const signature = await entry.account.signTypedData!(coerceTypedData(typedData as never) as never);
    logSign("sign/typed-data", entry, detail, "signed");
    return c.json({ signature });
  });

  app.post("/v1/sign/message", async (c) => {
    const entry = auth(c);
    if (!entry) return (logSign("sign/message", null, "", "401 unauthorized"), c.json({ error: "unauthorized" }, 401));
    const { message } = (await c.req.json()) as { message: string | { raw: string } };
    const signature = await entry.account.signMessage!({ message: message as never });
    logSign("sign/message", entry, "", "signed");
    return c.json({ signature });
  });

  return app;
}
