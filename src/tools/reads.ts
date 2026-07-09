import { z } from "zod";
import { formatEther, formatUnits, parseUnits, erc20Abi, isAddress } from "viem";
import { computePoolAddress, Pool, Position } from "@kumbaya_xyz/v3-sdk";
import { TradeType } from "@kumbaya_xyz/sdk-core";
import { publicClient, account } from "../clients.js";
import { DEFAULT_CHAIN_ID, getChain, type ChainId } from "../config/chains.js";
import { getToken } from "../lib/tokens.js";
import { quoteBest } from "../lib/routing.js";
import { UNIV3_POOL_ABI, NPM_ABI, FUEL_VAULT_ABI } from "../lib/abis.js";
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
  {
    name: "quote",
    description:
      "Best swap quote + route from tokenIn to tokenOut. Provide exactly one of amountIn (you spend) or amountOut (you want to receive), in human units. Read-only.",
    schema: {
      tokenIn: z.string().describe("Token you spend (address)."),
      tokenOut: z.string().describe("Token you receive (address)."),
      amountIn: z.string().optional().describe("Amount of tokenIn to spend (exact-in). Provide this OR amountOut."),
      amountOut: z.string().optional().describe("Amount of tokenOut wanted (exact-out). Provide this OR amountIn."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      if (Boolean(args.amountIn) === Boolean(args.amountOut))
        throw new Error("Provide exactly one of amountIn or amountOut.");
      const [tIn, tOut] = await Promise.all([getToken(chainId, args.tokenIn), getToken(chainId, args.tokenOut)]);
      const exactIn = Boolean(args.amountIn);
      const raw = exactIn ? parseUnits(args.amountIn, tIn.decimals) : parseUnits(args.amountOut, tOut.decimals);
      const q = await quoteBest({
        chainId,
        tokenIn: tIn.address,
        tokenOut: tOut.address,
        amount: raw.toString(),
        tradeType: exactIn ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT,
      });
      const inNum = Number(q.amountIn.toSignificant(12));
      const outNum = Number(q.amountOut.toSignificant(12));
      return {
        chainId,
        route: q.path.join(" -> "),
        tokenIn: { symbol: tIn.symbol, address: tIn.address },
        tokenOut: { symbol: tOut.symbol, address: tOut.address },
        amountIn: q.amountIn.toSignificant(8),
        amountInRaw: q.amountIn.quotient.toString(),
        amountOut: q.amountOut.toSignificant(8),
        amountOutRaw: q.amountOut.quotient.toString(),
        rate: inNum > 0 ? `1 ${tIn.symbol} ≈ ${(outNum / inNum).toPrecision(6)} ${tOut.symbol}` : undefined,
      };
    },
  },
  {
    name: "list_positions",
    description:
      "Uniswap V3 liquidity positions (NFTs) owned by an address: pair, fee tier, tick range, in-range status, underlying token amounts, and uncollected fees. Defaults to the configured wallet.",
    schema: {
      address: z.string().optional().describe("Owner address. Defaults to the configured wallet."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      const cfg = getChain(chainId);
      const pc = publicClient(chainId);
      const owner = (args.address || account()?.address) as `0x${string}` | undefined;
      if (!owner) throw new Error("No address provided and no wallet configured.");
      if (!isAddress(owner)) throw new Error("address is not a valid address");
      const npm = cfg.addresses.positionManager;

      const count = (await pc.readContract({
        address: npm,
        abi: NPM_ABI,
        functionName: "balanceOf",
        args: [owner],
      })) as bigint;

      const ids = (await Promise.all(
        Array.from({ length: Number(count) }, (_, i) =>
          pc.readContract({ address: npm, abi: NPM_ABI, functionName: "tokenOfOwnerByIndex", args: [owner, BigInt(i)] }),
        ),
      )) as bigint[];

      const positions = await Promise.all(
        ids.map(async (tokenId) => {
          const p = (await pc.readContract({
            address: npm,
            abi: NPM_ABI,
            functionName: "positions",
            args: [tokenId],
          })) as readonly unknown[];
          const [, , t0Addr, t1Addr, fee, tickLower, tickUpper, liq, , , owed0, owed1] = p as [
            bigint, string, string, string, number, number, number, bigint, bigint, bigint, bigint, bigint,
          ];
          const [token0, token1] = await Promise.all([getToken(chainId, t0Addr), getToken(chainId, t1Addr)]);
          const base = {
            tokenId: tokenId.toString(),
            pair: `${token0.symbol}/${token1.symbol}`,
            fee: Number(fee),
            tickLower: Number(tickLower),
            tickUpper: Number(tickUpper),
            liquidity: (liq as bigint).toString(),
            uncollectedFees: {
              [token0.symbol!]: formatUnits(owed0 as bigint, token0.decimals),
              [token1.symbol!]: formatUnits(owed1 as bigint, token1.decimals),
            },
          };
          if ((liq as bigint) === 0n) return { ...base, closed: true };
          const address = computePoolAddress({
            factoryAddress: cfg.addresses.factory,
            tokenA: token0,
            tokenB: token1,
            fee: Number(fee),
            chainId,
          }) as `0x${string}`;
          try {
            const [slot0, poolLiq] = (await Promise.all([
              pc.readContract({ address, abi: UNIV3_POOL_ABI, functionName: "slot0" }),
              pc.readContract({ address, abi: UNIV3_POOL_ABI, functionName: "liquidity" }),
            ])) as [readonly unknown[], bigint];
            const tick = Number(slot0[1] as number | bigint);
            const pool = new Pool(token0, token1, Number(fee), (slot0[0] as bigint).toString(), poolLiq.toString(), tick);
            const pos = new Position({ pool, liquidity: (liq as bigint).toString(), tickLower: Number(tickLower), tickUpper: Number(tickUpper) });
            return {
              ...base,
              inRange: tick >= Number(tickLower) && tick < Number(tickUpper),
              amounts: {
                [token0.symbol!]: pos.amount0.toSignificant(8),
                [token1.symbol!]: pos.amount1.toSignificant(8),
              },
            };
          } catch {
            return base;
          }
        }),
      );
      return { chainId, owner, count: Number(count), positions };
    },
  },
  {
    name: "get_tips",
    description:
      "Tip (FuelVault) balances for a token, denominated in that token: your spendable tip credits, and your creator earnings (liquid = withdrawable now, vested = still locked). Defaults to the configured wallet.",
    schema: {
      token: z.string().describe("The launched token address whose tip vault to read."),
      user: z.string().optional().describe("User/creator address. Defaults to the configured wallet."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      const cfg = getChain(chainId);
      const pc = publicClient(chainId);
      const user = (args.user || account()?.address) as `0x${string}` | undefined;
      if (!user) throw new Error("No user provided and no wallet configured.");
      if (!isAddress(user)) throw new Error("user is not a valid address");
      const token = await getToken(chainId, args.token);
      const vault = cfg.addresses.fuelVault;

      const [credits, bucket] = (await Promise.all([
        pc.readContract({ address: vault, abi: FUEL_VAULT_ABI, functionName: "getCredits", args: [user, token.address as `0x${string}`] }),
        pc.readContract({ address: vault, abi: FUEL_VAULT_ABI, functionName: "getCreatorBucket", args: [user, token.address as `0x${string}`] }),
      ])) as [bigint, readonly [bigint, bigint, boolean]];

      const [liquid, vested, unlocked] = bucket;
      return {
        chainId,
        token: { address: token.address, symbol: token.symbol, decimals: token.decimals },
        user,
        spendableCredits: formatUnits(credits, token.decimals),
        creatorEarnings: {
          liquid: formatUnits(liquid, token.decimals),
          vested: formatUnits(vested, token.decimals),
          unlocked,
          withdrawable: unlocked ? formatUnits(liquid, token.decimals) : "0",
        },
      };
    },
  },
];
