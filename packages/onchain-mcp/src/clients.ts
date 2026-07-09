// viem clients. Reads use a PublicClient (with multicall3). Writes use a WalletClient
// built from a private key in the env — resolved at runtime, never written to disk.
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { viemChain, type ChainId } from "./config/chains.js";
import { remoteAccount } from "./remoteAccount.js";

const _public = new Map<ChainId, PublicClient>();

export function publicClient(chainId: ChainId): PublicClient {
  let c = _public.get(chainId);
  if (!c) {
    c = createPublicClient({ chain: viemChain(chainId), transport: http(), batch: { multicall: true } });
    _public.set(chainId, c);
  }
  return c;
}

let _account: Account | null | undefined;

/**
 * The signing account, or null in read-only mode. Prefers the remote signer
 * (SIGNER_URL) so this process holds no key; otherwise uses a local key.
 */
export function account(): Account | null {
  if (_account !== undefined) return _account;
  const remote = remoteAccount();
  if (remote) {
    _account = remote;
    return _account;
  }
  const key = process.env.WALLET_PRIVATE_KEY || process.env.AGENT_WALLET_KEY || "";
  _account = key ? privateKeyToAccount(key.startsWith("0x") ? (key as `0x${string}`) : (`0x${key}` as `0x${string}`)) : null;
  return _account;
}

export function requireAccount(): Account {
  const a = account();
  if (!a) {
    throw new Error(
      "No signer configured. Set SIGNER_URL (+ SIGNER_TOKEN, SIGNER_ADDRESS) for the remote signer, or WALLET_PRIVATE_KEY for a local key."
    );
  }
  return a;
}

export function walletClient(chainId: ChainId): WalletClient {
  return createWalletClient({ account: requireAccount(), chain: viemChain(chainId), transport: http() });
}
