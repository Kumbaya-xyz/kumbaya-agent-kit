import { z } from "zod";
import { formatEther, formatUnits, erc20Abi, isAddress } from "viem";
import { computePoolAddress, Pool } from "@kumbaya_xyz/v3-sdk";
import { publicClient, account } from "../clients.js";
import { DEFAULT_CHAIN_ID, getChain, type ChainId } from "../config/chains.js";
import { getToken } from "../lib/tokens.js";
import { UNIV3_POOL_ABI } from "../lib/abis.js";
import type { ToolDef } from "./registry.js";

const chainArg = z
  .number()
  .int()
  .optional()
  .describe("Chain id: 4326 (MegaETH mainnet) or 6343 (testnet). Defaults to testnet.");

export const readTools: ToolDef[] = [
  {
    name: "get_balance",
    description:
      "ETH and (optional) ERC-20 token balance for an address. Defaults to the configured wallet address.",
    schema: {
      address: z.string().optional().describe("Address to check. Defaults to the configured wallet."),
      token: z.string().optional().describe("Optional ERC-20 token address to also report the balance of."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      const pc = publicClient(chainId);
      const addr = (args.address || account()?.address) as `0x${string}` | undefined;
      if (!addr) throw new Error("No address provided and no wallet configured.");
      if (!isAddress(addr)) throw new Error("address is not a valid address");
      const eth = await pc.getBalance({ address: addr });
      const out: Record<string, unknown> = {
        chainId,
        address: addr,
        eth: formatEther(eth),
        ethWei: eth.toString(),
      };
      if (args.token) {
        if (!isAddress(args.token)) throw new Error("token is not a valid address");
        const token = args.token as `0x${string}`;
        const [bal, dec, sym] = await Promise.all([
          pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
          pc.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
          pc
            .readContract({ address: token, abi: erc20Abi, functionName: "symbol" })
            .catch(() => "TOKEN"),
        ]);
        out.token = {
          address: token,
          symbol: sym,
          decimals: Number(dec),
          balance: formatUnits(bal as bigint, Number(dec)),
          balanceRaw: (bal as bigint).toString(),
        };
      }
      return out;
    },
  },
  {
    name: "get_token",
    description: "ERC-20 token metadata: symbol, name, decimals, and total supply.",
    schema: {
      token: z.string().describe("ERC-20 token address."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      const t = await getToken(chainId, args.token);
      const supply = (await publicClient(chainId).readContract({
        address: t.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "totalSupply",
      })) as bigint;
      return {
        chainId,
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        totalSupply: formatUnits(supply, t.decimals),
        totalSupplyRaw: supply.toString(),
      };
    },
  },
  {
    name: "get_pool",
    description:
      "Uniswap V3 pool state for a token pair + fee tier: pool address, current price (both directions), tick, and liquidity. fee is 100, 500, 3000, or 10000.",
    schema: {
      tokenA: z.string().describe("First token address."),
      tokenB: z.string().describe("Second token address."),
      fee: z.number().int().describe("Fee tier in hundredths of a bip: 100, 500, 3000, or 10000."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      const cfg = getChain(chainId);
      const [tokenA, tokenB] = await Promise.all([
        getToken(chainId, args.tokenA),
        getToken(chainId, args.tokenB),
      ]);
      const address = computePoolAddress({
        factoryAddress: cfg.addresses.factory,
        tokenA,
        tokenB,
        fee: args.fee,
        chainId,
      }) as `0x${string}`;

      const pc = publicClient(chainId);
      let slot0: readonly unknown[];
      let liquidity: bigint;
      try {
        [slot0, liquidity] = (await Promise.all([
          pc.readContract({ address, abi: UNIV3_POOL_ABI, functionName: "slot0" }),
          pc.readContract({ address, abi: UNIV3_POOL_ABI, functionName: "liquidity" }),
        ])) as [readonly unknown[], bigint];
      } catch {
        return { chainId, address, exists: false, note: "Pool not deployed or not initialized for this pair/fee." };
      }
      const sqrtPriceX96 = slot0[0] as bigint;
      const tick = Number(slot0[1] as number | bigint);
      const [token0, token1] = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA];
      const pool = new Pool(token0, token1, args.fee, sqrtPriceX96.toString(), liquidity.toString(), tick);
      return {
        chainId,
        address,
        exists: true,
        fee: args.fee,
        token0: { address: token0.address, symbol: token0.symbol },
        token1: { address: token1.address, symbol: token1.symbol },
        tick,
        sqrtPriceX96: sqrtPriceX96.toString(),
        liquidity: liquidity.toString(),
        price: {
          [`${token0.symbol}_per_${token1.symbol}`]: pool.token1Price.toSignificant(8),
          [`${token1.symbol}_per_${token0.symbol}`]: pool.token0Price.toSignificant(8),
        },
      };
    },
  },
];
