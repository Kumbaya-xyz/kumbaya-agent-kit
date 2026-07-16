import { z } from "zod";
import { parseUnits, formatUnits, erc20Abi, getAddress } from "viem";
import { publicClient, walletClient, requireAccount } from "../clients.js";
import { DEFAULT_CHAIN_ID, getChain, type ChainId } from "../config/chains.js";
import { getToken } from "../lib/tokens.js";
import { assertAllowedToken } from "../lib/tokenAllowlist.js";
import { noteInteracted } from "../lib/balances.js";
import { siweLogin } from "../lib/clientApi.js";
import { FUEL_VAULT_ABI } from "../lib/abis.js";
import type { ToolDef } from "./registry.js";

const chainArg = z
  .number()
  .int()
  .optional()
  .describe("Chain id: 4326 (mainnet) or 6343 (testnet). Defaults to testnet.");

/** Coerce message fields typed as uintN/intN to bigint so viem can sign them. */
function coerceTypedMessage(typedData: { types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }) {
  const fields = (typedData.types?.[typedData.primaryType] as Array<{ name: string; type: string }>) ?? [];
  const message: Record<string, unknown> = { ...typedData.message };
  for (const f of fields) {
    if (/^u?int\d*$/.test(f.type) && message[f.name] !== undefined && typeof message[f.name] !== "bigint") {
      message[f.name] = BigInt(message[f.name] as string | number);
    }
  }
  return message;
}

export const walletTools: ToolDef[] = [
  {
    name: "siwe_login",
    description:
      "Authenticate the configured wallet to the Kumbaya app (Sign In With Ethereum). Signs a session message with your wallet key and returns a JWT. " +
      "If KUMBAYA_JWT_FILE is set, the token is written there so the kumbaya-mcp (API) server picks it up automatically. Run this before any authenticated app/API action (e.g. tipping).",
    schema: { chainId: chainArg },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      const s = await siweLogin(chainId);
      return {
        authenticated: true,
        address: s.user.walletAddress,
        userId: s.user.id,
        expiresAt: s.expiresAt,
        jwtFile: s.jwtFile,
        note: s.jwtFile
          ? "Session written to KUMBAYA_JWT_FILE; kumbaya-mcp will use it."
          : "Set KUMBAYA_JWT_FILE (shared with kumbaya-mcp) to bridge this session automatically, or pass the token as KUMBAYA_JWT.",
        token: s.token,
      };
    },
  },
  {
    name: "sign_typed_data",
    description:
      "Sign EIP-712 typed data with your wallet key and return the signature. Use this to sign a permit returned by an API step (e.g. the GiftPermit from a gift prepare call) so it can be submitted via kumbaya-mcp.",
    schema: {
      typedData: z
        .object({
          domain: z.record(z.any()),
          types: z.record(z.any()),
          primaryType: z.string(),
          message: z.record(z.any()),
        })
        .describe("EIP-712 typed data with domain, types, primaryType, and message."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      const td = args.typedData as { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> };
      const signArgs = {
        account: requireAccount(),
        domain: td.domain,
        types: td.types,
        primaryType: td.primaryType,
        message: coerceTypedMessage(td),
      } as Parameters<ReturnType<typeof walletClient>["signTypedData"]>[0];
      const signature = await walletClient(chainId).signTypedData(signArgs);
      return { primaryType: td.primaryType, signature };
    },
  },
  {
    name: "deposit_credits",
    description:
      "Deposit a launched token from your wallet into your FuelVault credit balance (approve + depositFrom). Credits are spendable when tipping. Real transaction.",
    schema: {
      token: z.string().describe("The launched token address to deposit."),
      amount: z.string().describe("Amount to deposit (human units)."),
      chainId: chainArg,
    },
    handler: async (args) => {
      const chainId = (args.chainId ?? DEFAULT_CHAIN_ID) as ChainId;
      await assertAllowedToken(chainId, args.token, "token");
      noteInteracted(chainId, args.token);
      const cfg = getChain(chainId);
      const pc = publicClient(chainId);
      const wc = walletClient(chainId);
      const account = requireAccount();
      const me = account.address;
      const token = await getToken(chainId, args.token);
      const tokenAddr = getAddress(token.address);
      const vault = getAddress(cfg.addresses.fuelVault);
      const amount = parseUnits(args.amount, token.decimals);

      const bal = (await pc.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "balanceOf", args: [me] })) as bigint;
      if (bal < amount) throw new Error(`Insufficient ${token.symbol}: wallet holds ${formatUnits(bal, token.decimals)}.`);

      const allowance = (await pc.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "allowance", args: [me, vault] })) as bigint;
      if (allowance < amount) {
        const ah = await wc.writeContract({ account, chain: wc.chain, address: tokenAddr, abi: erc20Abi, functionName: "approve", args: [vault, amount] });
        await pc.waitForTransactionReceipt({ hash: ah });
      }
      const sim = await pc.simulateContract({ address: vault, abi: FUEL_VAULT_ABI, functionName: "depositFrom", args: [me, tokenAddr, amount], account });
      const hash = await wc.writeContract(sim.request);
      const receipt = await pc.waitForTransactionReceipt({ hash });
      const credits = (await pc.readContract({ address: vault, abi: FUEL_VAULT_ABI, functionName: "getCredits", args: [me, tokenAddr] })) as bigint;
      return {
        chainId,
        action: "deposit_credits",
        token: { address: token.address, symbol: token.symbol },
        deposited: `${args.amount} ${token.symbol}`,
        creditBalance: formatUnits(credits, token.decimals),
        txHash: hash,
        status: receipt.status,
        explorer: `${cfg.explorerUrl}/tx/${hash}`,
      };
    },
  },
];
