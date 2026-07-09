// Remote-signer account. When SIGNER_URL is set, the wallet key lives in a
// separate signing service; this process holds no key. A viem custom account
// delegates signTransaction/signTypedData/signMessage to the signer over HTTP,
// authenticated with a per-agent bearer token. The MCP still broadcasts.
import { toAccount } from "viem/accounts";
import { getAddress, type Account } from "viem";

const SIGNER_URL = process.env.SIGNER_URL?.replace(/\/$/, "");
const SIGNER_TOKEN = process.env.SIGNER_TOKEN || "";
const SIGNER_ADDRESS = process.env.SIGNER_ADDRESS;

/** JSON with bigints encoded as hex strings; the signer revives them. */
function jsonBig(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v));
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${SIGNER_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SIGNER_TOKEN}` },
    body: jsonBig(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`signer ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

/** The remote-signer account, or null if SIGNER_URL is not configured. */
export function remoteAccount(): Account | null {
  if (!SIGNER_URL) return null;
  if (!SIGNER_ADDRESS) throw new Error("SIGNER_URL is set but SIGNER_ADDRESS (the agent's public address) is missing.");
  return toAccount({
    address: getAddress(SIGNER_ADDRESS),
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
