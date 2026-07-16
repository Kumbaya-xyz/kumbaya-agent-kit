// Remote-signer account. When SIGNER_URL is set, the wallet key lives in a separate
// signing service; this process holds no key. A viem custom account delegates
// signTransaction/signTypedData/signMessage to the signer over HTTP, authenticated
// with a per-agent bearer token. The MCP still broadcasts.
//
// Address resolution: the address is a public derivation of the key, so it is NOT
// required as its own env var. If SIGNER_ADDRESS is set it's used directly (fast
// path, e.g. public users who provide it); otherwise initWallet() derives it from
// the signer's /v1/address at startup — the path Kumbaya's own agents use, which set
// only SIGNER_URL + SIGNER_TOKEN and never store the address.
import { toAccount } from "viem/accounts";
import { getAddress, type Account } from "viem";

const signerUrl = () => process.env.SIGNER_URL?.replace(/\/$/, "");
const signerToken = () => process.env.SIGNER_TOKEN || "";

// Address derived from /v1/address at startup, cached for the process lifetime.
let _resolvedAddress: string | undefined;

/** JSON with bigints encoded as hex strings; the signer revives them. */
function jsonBig(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v));
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${signerUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${signerToken()}` },
    body: jsonBig(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`signer ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function fetchAddress(): Promise<string | undefined> {
  try {
    const res = await fetch(`${signerUrl()}/v1/address`, {
      headers: { authorization: `Bearer ${signerToken()}` },
    });
    if (!res.ok) return undefined;
    const data = (await res.json().catch(() => ({}))) as { address?: unknown };
    return typeof data.address === "string" ? data.address : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve this agent's address once, before the MCP serves. No-op with a local key,
 *  no signer, or an explicit SIGNER_ADDRESS; otherwise derives it from the signer's
 *  /v1/address (short retry, since the signer may still be starting). If it stays
 *  unresolved, remoteAccount() throws a clear error on first use. */
export async function initWallet(): Promise<void> {
  if (!signerUrl() || process.env.SIGNER_ADDRESS) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const addr = await fetchAddress();
    if (addr) {
      _resolvedAddress = addr;
      return;
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
}

/** The remote-signer account, or null if no signer is configured (local-key mode). */
export function remoteAccount(): Account | null {
  if (!signerUrl()) return null;
  const address = process.env.SIGNER_ADDRESS ?? _resolvedAddress;
  if (!address) {
    throw new Error(
      "Signer address unresolved: set SIGNER_ADDRESS, or ensure the signer's /v1/address was reachable at startup.",
    );
  }
  return toAccount({
    address: getAddress(address),
    async signTransaction(transaction) {
      const { signedTransaction } = await post("/v1/sign/transaction", { transaction });
      return signedTransaction as `0x${string}`;
    },
    async signTypedData(typedData) {
      const { signature } = await post("/v1/sign/typed-data", { typedData });
      return signature as `0x${string}`;
    },
    async signMessage({ message }) {
      const { signature } = await post("/v1/sign/message", { message });
      return signature as `0x${string}`;
    },
  });
}
