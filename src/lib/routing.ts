// Client-side routing: candidate pools from the public keyless `pools/admitted`
// endpoint (avoids on-chain enumeration/rate-limits), then quote each route via
// QuoterV2. Mirrors the frontend's routing pipeline, headless.
import { Token, CurrencyAmount, TradeType } from "@kumbaya_xyz/sdk-core";
import { Pool, Route, encodeRouteToPath, computePoolAddress } from "@kumbaya_xyz/v3-sdk";
import { getAddress } from "viem";
import { EXCHANGE_API_URL, type ChainId, getChain } from "../config/chains.js";
import { getToken } from "./tokens.js";
import { publicClient } from "../clients.js";
import { QUOTER_V2_ABI, UNIV3_POOL_ABI } from "./abis.js";

interface AdmittedPool {
  address: string;
  fee: number;
  token0: string;
  token1: string;
  sqrtPriceX96: string;
  tick: number;
  liquidity: string;
}

const MAX_HOPS = 3;
const MAX_ROUTES = 24; // cap QuoterV2 calls
const FEE_TIERS = [100, 500, 3000, 10000];

/**
 * On-chain fallback for pools the public indexer hasn't admitted yet (e.g. a
 * token created seconds ago). Probes direct + via-WETH pairs across fee tiers.
 */
async function probeOnChainPools(chainId: ChainId, tIn: Token, tOut: Token): Promise<Pool[]> {
  const cfg = getChain(chainId);
  const pc = publicClient(chainId);
  const weth = await getToken(chainId, cfg.addresses.weth9);
  const pairs: Array<[Token, Token]> = [[tIn, tOut]];
  if (!tIn.equals(weth) && !tOut.equals(weth)) {
    pairs.push([tIn, weth], [tOut, weth]);
  }

  const candidates: Array<{ token0: Token; token1: Token; fee: number; address: `0x${string}` }> = [];
  const seen = new Set<string>();
  for (const [a, b] of pairs) {
    const [t0, t1] = a.sortsBefore(b) ? [a, b] : [b, a];
    for (const fee of FEE_TIERS) {
      const address = computePoolAddress({ factoryAddress: cfg.addresses.factory, tokenA: t0, tokenB: t1, fee, chainId }) as `0x${string}`;
      if (seen.has(address)) continue;
      seen.add(address);
      candidates.push({ token0: t0, token1: t1, fee, address });
    }
  }

  const states = await Promise.all(
    candidates.map(async (c) => {
      try {
        const [slot0, liquidity] = (await Promise.all([
          pc.readContract({ address: c.address, abi: UNIV3_POOL_ABI, functionName: "slot0" }),
          pc.readContract({ address: c.address, abi: UNIV3_POOL_ABI, functionName: "liquidity" }),
        ])) as [readonly unknown[], bigint];
        if (liquidity === 0n) return null;
        return new Pool(c.token0, c.token1, c.fee, (slot0[0] as bigint).toString(), liquidity.toString(), Number(slot0[1] as number | bigint));
      } catch {
        return null;
      }
    })
  );
  return states.filter((p): p is Pool => p !== null);
}

export async function fetchAdmittedPools(
  chainId: ChainId,
  tokenIn: string,
  tokenOut: string
): Promise<AdmittedPool[]> {
  const url = `${EXCHANGE_API_URL}/api/v1/pools/admitted?chainId=${chainId}&tokenIn=${tokenIn}&tokenOut=${tokenOut}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pools/admitted request failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { pools?: AdmittedPool[] };
  return data.pools ?? [];
}

async function buildPools(chainId: ChainId, admitted: AdmittedPool[]): Promise<Pool[]> {
  const addrs = new Set<string>();
  for (const p of admitted) {
    addrs.add(p.token0.toLowerCase());
    addrs.add(p.token1.toLowerCase());
  }
  const tokenList = await Promise.all([...addrs].map((a) => getToken(chainId, a)));
  const byAddr = new Map(tokenList.map((t) => [t.address.toLowerCase(), t]));
  const pools: Pool[] = [];
  for (const p of admitted) {
    const t0 = byAddr.get(p.token0.toLowerCase());
    const t1 = byAddr.get(p.token1.toLowerCase());
    if (!t0 || !t1) continue;
    if (p.liquidity === "0") continue;
    try {
      pools.push(new Pool(t0, t1, p.fee, p.sqrtPriceX96, p.liquidity, p.tick));
    } catch {
      /* skip malformed pool */
    }
  }
  return pools;
}

function enumerateRoutes(pools: Pool[], tokenIn: Token, tokenOut: Token): Route<Token, Token>[] {
  const routes: Route<Token, Token>[] = [];
  const key = (p: Pool) => `${p.token0.address}-${p.token1.address}-${p.fee}`;
  const dfs = (current: Token, path: Pool[], used: Set<string>) => {
    if (routes.length >= MAX_ROUTES) return;
    if (path.length > 0 && current.equals(tokenOut)) {
      routes.push(new Route([...path], tokenIn, tokenOut));
      return;
    }
    if (path.length >= MAX_HOPS) return;
    for (const pool of pools) {
      const k = key(pool);
      if (used.has(k)) continue;
      if (!pool.involvesToken(current)) continue;
      const next = current.equals(pool.token0) ? pool.token1 : pool.token0;
      used.add(k);
      dfs(next, [...path, pool], used);
      used.delete(k);
    }
  };
  dfs(tokenIn, [], new Set());
  return routes;
}

export interface QuoteResult {
  route: Route<Token, Token>;
  path: string[]; // token symbols along the route
  amountIn: CurrencyAmount<Token>;
  amountOut: CurrencyAmount<Token>;
  tradeType: TradeType;
}

/** Best route + amounts for a swap. `amount` is a raw base-unit string of the fixed side. */
export async function quoteBest(params: {
  chainId: ChainId;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  tradeType: TradeType;
}): Promise<QuoteResult> {
  const { chainId, tokenIn, tokenOut, amount, tradeType } = params;
  const [tIn, tOut] = await Promise.all([getToken(chainId, tokenIn), getToken(chainId, tokenOut)]);
  const admitted = await fetchAdmittedPools(chainId, tIn.address, tOut.address).catch(() => []);
  let pools = await buildPools(chainId, admitted);
  let routes = enumerateRoutes(pools, tIn, tOut);
  if (routes.length === 0) {
    // Fallback: the indexer may not have admitted the pool yet (freshly launched
    // token). Probe direct + via-WETH pairs on-chain and merge.
    const probed = await probeOnChainPools(chainId, tIn, tOut);
    const key = (p: Pool) => `${p.token0.address}-${p.token1.address}-${p.fee}`;
    const merged = new Map(pools.map((p) => [key(p), p]));
    for (const p of probed) merged.set(key(p), p);
    pools = [...merged.values()];
    routes = enumerateRoutes(pools, tIn, tOut);
  }
  if (routes.length === 0) throw new Error("No route found between these tokens.");

  const pc = publicClient(chainId);
  const quoterV2 = getChain(chainId).addresses.quoterV2;
  const exactIn = tradeType === TradeType.EXACT_INPUT;

  const quoted = await Promise.all(
    routes.map(async (route) => {
      try {
        const path = encodeRouteToPath(route, !exactIn) as `0x${string}`;
        const { result } = await pc.simulateContract({
          address: quoterV2,
          abi: QUOTER_V2_ABI,
          functionName: exactIn ? "quoteExactInput" : "quoteExactOutput",
          args: [path, BigInt(amount)],
        });
        const value = (result as readonly bigint[])[0]; // amountOut (in) or amountIn (out)
        return { route, value };
      } catch {
        return null;
      }
    })
  );

  const valid = quoted.filter((q): q is { route: Route<Token, Token>; value: bigint } => q !== null);
  if (valid.length === 0) throw new Error("All candidate routes failed to quote (likely no liquidity).");

  // exact-in: maximize amountOut; exact-out: minimize amountIn
  const best = valid.reduce((a, b) => (exactIn ? (b.value > a.value ? b : a) : b.value < a.value ? b : a));

  const amountIn = exactIn
    ? CurrencyAmount.fromRawAmount(tIn, amount)
    : CurrencyAmount.fromRawAmount(tIn, best.value.toString());
  const amountOut = exactIn
    ? CurrencyAmount.fromRawAmount(tOut, best.value.toString())
    : CurrencyAmount.fromRawAmount(tOut, amount);

  return {
    route: best.route,
    path: best.route.tokenPath.map((t) => t.symbol ?? t.address.slice(0, 6)),
    amountIn,
    amountOut,
    tradeType,
  };
}
