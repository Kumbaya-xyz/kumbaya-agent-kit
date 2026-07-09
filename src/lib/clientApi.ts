// SIWE wallet auth against the Kumbaya client-API. The wallet key signs an
// EIP-4361 message to mint a session JWT the wallet owns. No Privy account needed.
import { writeFileSync } from "node:fs";
import { CLIENT_API_URL, JWT_FILE, type ChainId } from "../config/chains.js";
import { walletClient, requireAccount } from "../clients.js";

export interface SiweSession {
  token: string;
  expiresAt: string;
  user: { id: string; walletAddress: string; name: string | null };
}

/** SIWE login with the configured wallet key. Writes the JWT to KUMBAYA_JWT_FILE when set. */
export async function siweLogin(chainId: ChainId): Promise<SiweSession & { jwtFile?: string }> {
  const account = requireAccount();
  const address = account.address;

  const nonceRes = await fetch(`${CLIENT_API_URL}/v1/session/wallet/nonce?address=${address}`);
  if (!nonceRes.ok) throw new Error(`SIWE nonce failed: ${nonceRes.status} ${nonceRes.statusText}`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const host = new URL(CLIENT_API_URL).host;
  const message =
    `${host} wants you to sign in with your Ethereum account:\n` +
    `${address}\n\n` +
    `Sign in to Kumbaya.\n\n` +
    `URI: ${CLIENT_API_URL}\n` +
    `Version: 1\n` +
    `Chain ID: ${chainId}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${new Date().toISOString()}`;

  const signature = await walletClient(chainId).signMessage({ account, message });

  const verifyRes = await fetch(`${CLIENT_API_URL}/v1/session/wallet/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) throw new Error(`SIWE verify failed: ${verifyRes.status} ${await verifyRes.text().catch(() => "")}`);
  const session = (await verifyRes.json()) as SiweSession;

  let jwtFile: string | undefined;
  if (JWT_FILE) {
    writeFileSync(JWT_FILE, session.token, "utf8");
    jwtFile = JWT_FILE;
  }
  return { ...session, jwtFile };
}
