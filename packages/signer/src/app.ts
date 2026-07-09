import { Hono } from "hono";
import { getAddress } from "viem";
import { loadKeystore, type AgentEntry, type Policy } from "./keystore.js";

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
    if (!entry) return c.json({ error: "unauthorized" }, 401);
    const { transaction } = (await c.req.json()) as { transaction: Record<string, unknown> };
    const tx = reviveTx(transaction);
    const denied = checkPolicy(entry.policy, tx);
    if (denied) return c.json({ error: `policy: ${denied}` }, 403);
    if (!entry.account.signTransaction) return c.json({ error: "account cannot sign transactions" }, 500);
    const signedTransaction = await entry.account.signTransaction(tx as never);
    return c.json({ signedTransaction });
  });

  app.post("/v1/sign/typed-data", async (c) => {
    const entry = auth(c);
    if (!entry) return c.json({ error: "unauthorized" }, 401);
    const { typedData } = (await c.req.json()) as { typedData: Record<string, unknown> };
    const signature = await entry.account.signTypedData!(coerceTypedData(typedData as never) as never);
    return c.json({ signature });
  });

  app.post("/v1/sign/message", async (c) => {
    const entry = auth(c);
    if (!entry) return c.json({ error: "unauthorized" }, 401);
    const { message } = (await c.req.json()) as { message: string | { raw: string } };
    const signature = await entry.account.signMessage!({ message: message as never });
    return c.json({ signature });
  });

  return app;
}
