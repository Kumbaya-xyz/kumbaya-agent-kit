// All-token balances. The indexer has no holdings endpoint and there is no on-chain
// way to enumerate which tokens an address holds, so we DISCOVER candidate tokens via
// the block explorer (Blockscout `tokenlist`), then VERIFY every balance on-chain —
// the explorer can lag, so it is used only to find addresses, never for balances.
// The wallet's session record (tokens it launched or traded this run) is folded in so
// a just-bought/just-launched token the explorer hasn't indexed yet still shows up.
import { formatEther, formatUnits, erc20Abi, getAddress, isAddress } from "viem";
import { publicClient } from "../clients.js";
import { type ChainId } from "../config/chains.js";
import { selfLaunchedTokens } from "./tokenAllowlist.js";

const BLOCKSCOUT_API: Record<ChainId, string> = {
  4326: process.env.KUMBAYA_BLOCKSCOUT_4326 || "https://megaeth.blockscout.com/api",
  6343: process.env.KUMBAYA_BLOCKSCOUT_6343 || "https://megaeth-testnet-v2.blockscout.com/api",
};

// Tokens this process has traded/deposited this run, per chain. An accurate, LLM-free
// record that patches explorer indexing lag; the explorer covers everything older.
const interacted = new Map<ChainId, Set<string>>();

export function noteInteracted(chainId: ChainId, token: string): void {
  const s = interacted.get(chainId) ?? new Set<string>();
  s.add(token.toLowerCase());
  interacted.set(chainId, s);
}

export async function blockscoutTokenList(chainId: ChainId, address: string): Promise<string[]> {
  const url = `${BLOCKSCOUT_API[chainId]}?module=account&action=tokenlist&address=${address}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      status?: string;
      result?: Array<{ contractAddress?: string; type?: string }>;
    };
    if (data.status !== "1" || !Array.isArray(data.result)) return [];
    return data.result
      .filter((t) => (t.type ?? "").toUpperCase() === "ERC-20")
      .map((t) => t.contractAddress)
      .filter((a): a is string => typeof a === "string" && isAddress(a));
  } catch {
    return [];
  }
}

export async function listBalances(chainId: ChainId, address: string, extra: string[] = []) {
  if (!isAddress(address)) throw new Error("address is not a valid address");
  const addr = getAddress(address);
  const pc = publicClient(chainId);

  const discovered = await blockscoutTokenList(chainId, addr);
  const provided = extra.filter((a) => isAddress(a));
  const launched = selfLaunchedTokens(chainId);
  const session = [...(interacted.get(chainId) ?? [])];
  const candidates = Array.from(
    new Set([...discovered, ...provided, ...launched, ...session].map((a) => a.toLowerCase())),
  ).filter((a) => isAddress(a));

  // On-chain balanceOf/decimals/symbol for every candidate (auto-batched via multicall3).
  const [eth, rows] = await Promise.all([
    pc.getBalance({ address: addr }),
    Promise.all(
      candidates.map(async (t) => {
        const token = getAddress(t);
        try {
          const [bal, dec, sym] = await Promise.all([
            pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
            pc.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
            pc.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => "TOKEN"),
          ]);
          const raw = bal as bigint;
          if (raw <= 0n) return null;
          return {
            address: token,
            symbol: sym as string,
            decimals: Number(dec),
            balance: formatUnits(raw, Number(dec)),
            balanceRaw: raw.toString(),
          };
        } catch {
          return null; // non-standard/broken token: skip rather than fail the whole call
        }
      }),
    ),
  ]);

  const tokens = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  return {
    chainId,
    address: addr,
    eth: formatEther(eth),
    ethWei: eth.toString(),
    tokenCount: tokens.length,
    tokens,
    // How the candidate set was assembled (balances are always on-chain-verified).
    discovery: { explorer: discovered.length, provided: provided.length, session: launched.length + session.length },
  };
}
