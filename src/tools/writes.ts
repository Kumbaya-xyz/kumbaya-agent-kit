import { z } from "zod";
import { parseUnits, erc20Abi, isAddress, getAddress } from "viem";
import { Ether, CurrencyAmount, Percent, TradeType, type Currency } from "@kumbaya_xyz/sdk-core";
import { Route } from "@kumbaya_xyz/v3-sdk";
import { SwapRouter, Trade as RouterSdkTrade } from "@kumbaya_xyz/router-sdk";
import { publicClient, walletClient, requireAccount } from "../clients.js";
import { DEFAULT_CHAIN_ID, getChain, type ChainId } from "../config/chains.js";
import { getToken } from "../lib/tokens.js";
import { quoteBest } from "../lib/routing.js";
import type { ToolDef } from "./registry.js";

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
];
