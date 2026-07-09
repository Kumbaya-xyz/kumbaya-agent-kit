import { z } from "zod";
import { parseUnits, formatUnits, erc20Abi, isAddress, getAddress } from "viem";
import { Ether, CurrencyAmount, Percent, TradeType, type Currency } from "@kumbaya_xyz/sdk-core";
import {
  Route,
  Pool,
  Position,
  NonfungiblePositionManager,
  computePoolAddress,
  nearestUsableTick,
  TickMath,
} from "@kumbaya_xyz/v3-sdk";
import { SwapRouter, Trade as RouterSdkTrade } from "@kumbaya_xyz/router-sdk";
import { publicClient, walletClient, requireAccount } from "../clients.js";
import { DEFAULT_CHAIN_ID, getChain, type ChainId } from "../config/chains.js";
import { getToken } from "../lib/tokens.js";
import { quoteBest } from "../lib/routing.js";
import { UNIV3_POOL_ABI, NPM_ABI } from "../lib/abis.js";
import type { ToolDef } from "./registry.js";

const MAX_UINT128 = (1n << 128n) - 1n;

/** Load a live Pool object (slot0 + liquidity) for a token pair + fee. */
async function loadPool(chainId: ChainId, addrA: string, addrB: string, fee: number) {
  const cfg = getChain(chainId);
  const pc = publicClient(chainId);
  const [tA, tB] = await Promise.all([getToken(chainId, addrA), getToken(chainId, addrB)]);
  const [token0, token1] = tA.sortsBefore(tB) ? [tA, tB] : [tB, tA];
  const address = computePoolAddress({ factoryAddress: cfg.addresses.factory, tokenA: token0, tokenB: token1, fee, chainId }) as `0x${string}`;
  const [slot0, liquidity] = (await Promise.all([
    pc.readContract({ address, abi: UNIV3_POOL_ABI, functionName: "slot0" }),
    pc.readContract({ address, abi: UNIV3_POOL_ABI, functionName: "liquidity" }),
  ])) as [readonly unknown[], bigint];
  const pool = new Pool(token0, token1, fee, (slot0[0] as bigint).toString(), liquidity.toString(), Number(slot0[1] as number | bigint));
  return { pool, token0, token1, address };
}

const chainArg = z
  .number()
  .int()
  .optional()
  .describe("Chain id: 4326 (mainnet) or 6343 (testnet). Defaults to testnet.");

const DEADLINE_SECS = 20 * 60;

function slippagePercent(bps?: number): Percent {
  const v = Number.isFinite(bps as number) ? Math.max(0, Math.min(5000, Math.round(bps as number))) : 50;
  return new Percent(v, 10_000);
}

/** Send a prepared tx and wait for the receipt. Returns hash + status + explorer link. */
async function sendAndWait(chainId: ChainId, tx: { to: `0x${string}`; data: `0x${string}`; value: bigint }) {
  const wc = walletClient(chainId);
  const pc = publicClient(chainId);
  const hash = await wc.sendTransaction({
    account: requireAccount(),
    chain: wc.chain,
    to: tx.to,
    data: tx.data,
    value: tx.value,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  return {
    txHash: hash,
    status: receipt.status,
    explorer: `${getChain(chainId).explorerUrl}/tx/${hash}`,
  };
}

/** Ensure `spender` can pull `amount` of `token` from the wallet; approve (max) if not. */
async function ensureAllowance(
  chainId: ChainId,
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint
): Promise<{ approved: boolean; txHash?: string }> {
  const pc = publicClient(chainId);
  const owner = requireAccount().address;
  const allowance = (await pc.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
  if (allowance >= amount) return { approved: false };
  const wc = walletClient(chainId);
  const hash = await wc.writeContract({
    account: requireAccount(),
    chain: wc.chain,
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
  await pc.waitForTransactionReceipt({ hash });
  return { approved: true, txHash: hash };
}

export const writeTools: ToolDef[] = [
  {
    name: "swap",
    description:
      "Swap tokens on Kumbaya (Uniswap V3). Provide exactly one of amountIn (exact-in) or amountOut (exact-out), in human units. " +
      "Use the WETH address for tokenIn/tokenOut to pay/receive native ETH (no wrapping needed). ERC-20 inputs are auto-approved to the router. Sends a real transaction.",
    schema: {
      tokenIn: z.string().describe("Token to spend (address). Use WETH to pay with native ETH."),
      tokenOut: z.string().describe("Token to receive (address). Use WETH to receive native ETH."),
      amountIn: z.string().optional().describe("Amount to spend (exact-in). Provide this OR amountOut."),
      amountOut: z.string().optional().describe("Amount to receive (exact-out). Provide this OR amountIn."),
      slippageBps: z.number().int().optional().describe("Max slippage in basis points (default 50 = 0.5%)."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      if (Boolean(args.amountIn) === Boolean(args.amountOut))
        throw new Error("Provide exactly one of amountIn or amountOut.");
      const cfg = getChain(chainId);
      const [tIn, tOut] = await Promise.all([getToken(chainId, args.tokenIn), getToken(chainId, args.tokenOut)]);
      const exactIn = Boolean(args.amountIn);
      const fixedRaw = exactIn
        ? parseUnits(args.amountIn, tIn.decimals)
        : parseUnits(args.amountOut, tOut.decimals);

      const q = await quoteBest({
        chainId,
        tokenIn: tIn.address,
        tokenOut: tOut.address,
        amount: fixedRaw.toString(),
        tradeType: exactIn ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT,
      });

      // Native ETH in/out when the WETH address is used (matches a wallet that holds ETH).
      const weth = getAddress(cfg.addresses.weth9);
      const nativeIn = getAddress(tIn.address) === weth;
      const nativeOut = getAddress(tOut.address) === weth;
      const native = Ether.onChain(chainId);
      const inCur: Currency = nativeIn ? native : tIn;
      const outCur: Currency = nativeOut ? native : tOut;

      const route = new Route(q.route.pools, inCur, outCur);
      const inputAmount = CurrencyAmount.fromRawAmount(inCur, q.amountIn.quotient.toString());
      const outputAmount = CurrencyAmount.fromRawAmount(outCur, q.amountOut.quotient.toString());
      const trade = new RouterSdkTrade({
        v3Routes: [{ routev3: route, inputAmount, outputAmount }],
        tradeType: q.tradeType,
      });

      const deadline = String(Math.floor(Date.now() / 1000) + DEADLINE_SECS);
      const { calldata, value } = SwapRouter.swapCallParameters(trade, {
        recipient: requireAccount().address,
        slippageTolerance: slippagePercent(args.slippageBps),
        deadlineOrPreviousBlockhash: deadline,
      });

      // ERC-20 input needs an allowance to the router; native ETH does not.
      let approval: { approved: boolean; txHash?: string } | undefined;
      if (!nativeIn) {
        approval = await ensureAllowance(
          chainId,
          getAddress(tIn.address),
          getAddress(cfg.addresses.swapRouter02),
          BigInt(inputAmount.quotient.toString())
        );
      }

      const sent = await sendAndWait(chainId, {
        to: getAddress(cfg.addresses.swapRouter02),
        data: calldata as `0x${string}`,
        value: BigInt(value),
      });

      return {
        chainId,
        action: "swap",
        route: q.path.join(" -> "),
        spent: `${q.amountIn.toSignificant(8)} ${tIn.symbol}${nativeIn ? " (native ETH)" : ""}`,
        received: `~${q.amountOut.toSignificant(8)} ${tOut.symbol}${nativeOut ? " (native ETH)" : ""}`,
        slippageBps: args.slippageBps ?? 50,
        approvalTx: approval?.txHash,
        ...sent,
      };
    },
  },
  {
    name: "add_liquidity",
    description:
      "Provide liquidity to a Kumbaya V3 pool (mints a new position NFT). Deposits up to amountA of tokenA and amountB of tokenB following the pool ratio. " +
      "Use the WETH address to deposit native ETH. Defaults to a full-range position; pass tickLower/tickUpper for a concentrated range. ERC-20 sides are auto-approved to the position manager. Real transaction.",
    schema: {
      tokenA: z.string().describe("First token address. Use WETH to deposit native ETH."),
      tokenB: z.string().describe("Second token address. Use WETH to deposit native ETH."),
      fee: z.number().int().describe("Fee tier: 100, 500, 3000, or 10000."),
      amountA: z.string().describe("Max amount of tokenA to deposit (human units)."),
      amountB: z.string().describe("Max amount of tokenB to deposit (human units)."),
      tickLower: z.number().int().optional().describe("Lower tick of the range (aligned to spacing). Omit for full range."),
      tickUpper: z.number().int().optional().describe("Upper tick of the range (aligned to spacing). Omit for full range."),
      slippageBps: z.number().int().optional().describe("Max slippage in basis points (default 50 = 0.5%)."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      const cfg = getChain(chainId);
      const npm = getAddress(cfg.addresses.positionManager);
      const fee = args.fee;
      const { pool, token0, token1 } = await loadPool(chainId, args.tokenA, args.tokenB, fee);

      const aIsToken0 = getAddress(args.tokenA) === getAddress(token0.address);
      const amount0Raw = parseUnits(aIsToken0 ? args.amountA : args.amountB, token0.decimals);
      const amount1Raw = parseUnits(aIsToken0 ? args.amountB : args.amountA, token1.decimals);

      const spacing = pool.tickSpacing;
      const hasRange = args.tickLower !== undefined && args.tickUpper !== undefined;
      const tickLower = hasRange ? nearestUsableTick(args.tickLower, spacing) : nearestUsableTick(TickMath.MIN_TICK, spacing);
      const tickUpper = hasRange ? nearestUsableTick(args.tickUpper, spacing) : nearestUsableTick(TickMath.MAX_TICK, spacing);
      if (tickLower >= tickUpper) throw new Error("tickLower must be below tickUpper");

      const position = Position.fromAmounts({
        pool,
        tickLower,
        tickUpper,
        amount0: amount0Raw.toString(),
        amount1: amount1Raw.toString(),
        useFullPrecision: true,
      });
      if (position.liquidity.toString() === "0")
        throw new Error("Computed zero liquidity — increase amounts or widen the range.");

      const weth = getAddress(cfg.addresses.weth9);
      const t0IsWeth = getAddress(token0.address) === weth;
      const t1IsWeth = getAddress(token1.address) === weth;
      const useNative = t0IsWeth || t1IsWeth ? Ether.onChain(chainId) : undefined;
      const slippage = slippagePercent(args.slippageBps);

      const { calldata, value } = NonfungiblePositionManager.addCallParameters(position, {
        recipient: requireAccount().address,
        slippageTolerance: slippage,
        deadline: String(Math.floor(Date.now() / 1000) + DEADLINE_SECS),
        useNative,
        createPool: false,
      });

      // Approve the DESIRED amounts the position manager will pull (mintAmounts),
      // not mintAmountsWithSlippage (which is the lower slippage-min used for amountMin).
      const { amount0: max0, amount1: max1 } = position.mintAmounts;
      const approvals: Record<string, string> = {};
      if (!t0IsWeth && BigInt(max0.toString()) > 0n) {
        const a = await ensureAllowance(chainId, getAddress(token0.address), npm, BigInt(max0.toString()));
        if (a.txHash) approvals[token0.symbol!] = a.txHash;
      }
      if (!t1IsWeth && BigInt(max1.toString()) > 0n) {
        const a = await ensureAllowance(chainId, getAddress(token1.address), npm, BigInt(max1.toString()));
        if (a.txHash) approvals[token1.symbol!] = a.txHash;
      }

      const sent = await sendAndWait(chainId, { to: npm, data: calldata as `0x${string}`, value: BigInt(value) });
      return {
        chainId,
        action: "add_liquidity",
        pair: `${token0.symbol}/${token1.symbol}`,
        fee,
        range: hasRange ? { tickLower, tickUpper } : "full",
        deposited: {
          [token0.symbol!]: position.amount0.toSignificant(8),
          [token1.symbol!]: position.amount1.toSignificant(8),
        },
        approvalTxs: Object.keys(approvals).length ? approvals : undefined,
        ...sent,
      };
    },
  },
  {
    name: "collect_fees",
    description: "Collect accumulated trading fees from a liquidity position (by NFT tokenId) to your wallet, without removing liquidity. Real transaction.",
    schema: {
      tokenId: z.union([z.string(), z.number()]).describe("The position NFT token id."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      const cfg = getChain(chainId);
      const pc = publicClient(chainId);
      const npm = getAddress(cfg.addresses.positionManager);
      const owner = requireAccount().address;
      const tokenId = BigInt(args.tokenId);

      const p = (await pc.readContract({ address: npm, abi: NPM_ABI, functionName: "positions", args: [tokenId] })) as readonly unknown[];
      const [token0, token1] = await Promise.all([getToken(chainId, p[2] as string), getToken(chainId, p[3] as string)]);

      const sim = await pc.simulateContract({
        address: npm,
        abi: NPM_ABI,
        functionName: "collect",
        args: [{ tokenId, recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
        account: requireAccount(),
      });
      const [amt0, amt1] = sim.result as readonly [bigint, bigint];

      const wc = walletClient(chainId);
      const hash = await wc.writeContract(sim.request);
      const receipt = await pc.waitForTransactionReceipt({ hash });
      return {
        chainId,
        action: "collect_fees",
        tokenId: tokenId.toString(),
        collected: {
          [token0.symbol!]: formatUnits(amt0, token0.decimals),
          [token1.symbol!]: formatUnits(amt1, token1.decimals),
        },
        txHash: hash,
        status: receipt.status,
        explorer: `${cfg.explorerUrl}/tx/${hash}`,
      };
    },
  },
  {
    name: "remove_liquidity",
    description:
      "Remove liquidity from a position NFT (by tokenId). Withdraws the given percent of principal plus all accrued fees to your wallet. " +
      "percent=100 also burns the empty NFT. Tokens are returned as pool tokens (WETH stays WETH). Real transaction.",
    schema: {
      tokenId: z.union([z.string(), z.number()]).describe("The position NFT token id."),
      percent: z.number().min(1).max(100).optional().describe("Percent of liquidity to remove (1-100, default 100)."),
      slippageBps: z.number().int().optional().describe("Max slippage in basis points (default 50 = 0.5%)."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      const cfg = getChain(chainId);
      const pc = publicClient(chainId);
      const npm = getAddress(cfg.addresses.positionManager);
      const owner = requireAccount().address;
      const tokenId = BigInt(args.tokenId);
      const percent = args.percent ?? 100;

      const p = (await pc.readContract({ address: npm, abi: NPM_ABI, functionName: "positions", args: [tokenId] })) as readonly unknown[];
      const [, , t0Addr, t1Addr, feeRaw, tickLower, tickUpper, liquidity] = p as [
        bigint, string, string, string, number, number, number, bigint,
      ];
      if ((liquidity as bigint) === 0n) throw new Error("Position has no liquidity to remove.");
      const { pool } = await loadPool(chainId, t0Addr, t1Addr, Number(feeRaw));
      const fullPosition = new Position({
        pool,
        liquidity: (liquidity as bigint).toString(),
        tickLower: Number(tickLower),
        tickUpper: Number(tickUpper),
      });

      // Current uncollected fees (static collect before decreasing) -> expectedCurrencyOwed.
      const sim = await pc.simulateContract({
        address: npm,
        abi: NPM_ABI,
        functionName: "collect",
        args: [{ tokenId, recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
        account: requireAccount(),
      });
      const [fee0, fee1] = sim.result as readonly [bigint, bigint];

      const { calldata, value } = NonfungiblePositionManager.removeCallParameters(fullPosition, {
        tokenId: tokenId.toString(),
        liquidityPercentage: new Percent(percent, 100),
        slippageTolerance: slippagePercent(args.slippageBps),
        deadline: String(Math.floor(Date.now() / 1000) + DEADLINE_SECS),
        burnToken: percent === 100,
        collectOptions: {
          expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(pool.token0, fee0.toString()),
          expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(pool.token1, fee1.toString()),
          recipient: owner,
        },
      });

      const sent = await sendAndWait(chainId, { to: npm, data: calldata as `0x${string}`, value: BigInt(value) });
      const removed = fullPosition.liquidity;
      return {
        chainId,
        action: "remove_liquidity",
        tokenId: tokenId.toString(),
        pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
        percent,
        burned: percent === 100,
        approxWithdrawn: {
          [pool.token0.symbol!]: fullPosition.amount0.multiply(percent).divide(100).toSignificant(8),
          [pool.token1.symbol!]: fullPosition.amount1.multiply(percent).divide(100).toSignificant(8),
        },
        uncollectedFees: {
          [pool.token0.symbol!]: formatUnits(fee0, pool.token0.decimals),
          [pool.token1.symbol!]: formatUnits(fee1, pool.token1.decimals),
        },
        liquidityRemoved: removed.toString(),
        ...sent,
      };
    },
  },
];
