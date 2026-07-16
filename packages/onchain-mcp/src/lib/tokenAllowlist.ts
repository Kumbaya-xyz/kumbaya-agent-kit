// On-chain actions are restricted to tokens the platform recognizes: launchpad,
// bluechip, or verified. The keyless search service is the source of truth — its
// `visibility=trusted` filter is exactly "bluechip + verified + fire (launchpad)".
// We look the specific token up by address (not list-all: that endpoint caps at
// 100 with no pagination) and require an exact address match to defeat fuzzy hits.
// A token this process just launched via ignite is allowed immediately (before it
// is indexed) via an in-memory self-launched set.
import { getAddress } from "viem";
import { SEARCH_API_URL, getChain, type ChainId } from "../config/chains.js";

const TTL_MS = 60_000;

type CacheEntry = { allowed: boolean; expires: number };
const cache = new Map<string, CacheEntry>();
const selfLaunched = new Map<ChainId, Set<string>>();

const low = (a: string) => a.toLowerCase();
const key = (chainId: ChainId, addr: string) => `${chainId}:${low(addr)}`;

/** Record a token this process created via ignite so the launch -> seed-liquidity
 *  flow works before the token is indexed. Unspoofable: it is our own record. */
export function markSelfLaunched(chainId: ChainId, token: string): void {
  const s = selfLaunched.get(chainId) ?? new Set<string>();
  s.add(low(token));
  selfLaunched.set(chainId, s);
}

export function selfLaunchedTokens(chainId: ChainId): string[] {
  return [...(selfLaunched.get(chainId) ?? [])];
}

type SearchToken = { address?: unknown };

async function isTrusted(chainId: ChainId, addr: string): Promise<boolean> {
  const url =
    `${SEARCH_API_URL}/api/v1/search/tokens` +
    `?q=${addr}&chainId=${chainId}&visibility=trusted&limit=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`token search ${res.status} for ${addr}`);
  const data = (await res.json()) as { tokens?: SearchToken[] };
  // Search is fuzzy; require an exact address match among the trusted results.
  return (data.tokens ?? []).some((t) => typeof t.address === "string" && low(t.address) === addr);
}

/** True if the token is WETH (routing numeraire), self-launched this session, or
 *  trusted (bluechip/verified/launchpad) per the search service. Fails closed if
 *  the search service can't be reached. */
export async function isAllowedToken(chainId: ChainId, token: string): Promise<boolean> {
  const addr = low(token);
  if (addr === low(getChain(chainId).addresses.weth9)) return true;
  if (selfLaunched.get(chainId)?.has(addr)) return true;

  const hit = cache.get(key(chainId, addr));
  if (hit && hit.expires > Date.now()) return hit.allowed;

  const allowed = await isTrusted(chainId, addr); // throws -> caller fails closed
  cache.set(key(chainId, addr), { allowed, expires: Date.now() + TTL_MS });
  return allowed;
}

export async function assertAllowedToken(chainId: ChainId, token: string, label = "token"): Promise<void> {
  let allowed = false;
  try {
    allowed = await isAllowedToken(chainId, token);
  } catch {
    throw new Error(
      `Could not verify ${label} ${getAddress(token)} against the token registry (search service ` +
        `unreachable). On-chain actions are blocked until it can be verified.`,
    );
  }
  if (!allowed) {
    throw new Error(
      `${label} ${getAddress(token)} is not allowlisted. On-chain actions are restricted to ` +
        `launchpad, bluechip, or verified tokens (the Kumbaya token registry).`,
    );
  }
}
