import { z } from "zod";
import { formatEther, formatUnits, erc20Abi, isAddress } from "viem";
import { publicClient, account } from "../clients.js";
import { DEFAULT_CHAIN_ID, type ChainId } from "../config/chains.js";
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
];
