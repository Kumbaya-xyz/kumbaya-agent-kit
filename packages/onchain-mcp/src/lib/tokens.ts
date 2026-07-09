// Build @kumbaya_xyz/sdk-core Token objects from on-chain metadata (cached per chain).
import { erc20Abi, isAddress, getAddress } from "viem";
import { Token } from "@kumbaya_xyz/sdk-core";
import { publicClient } from "../clients.js";
import type { ChainId } from "../config/chains.js";

const cache = new Map<string, Token>();

export async function getToken(chainId: ChainId, address: string): Promise<Token> {
  if (!isAddress(address)) throw new Error(`Not a valid token address: ${address}`);
  const checksummed = getAddress(address);
  const key = `${chainId}:${checksummed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pc = publicClient(chainId);
  const [decimals, symbol, name] = await Promise.all([
    pc.readContract({ address: checksummed, abi: erc20Abi, functionName: "decimals" }),
    pc.readContract({ address: checksummed, abi: erc20Abi, functionName: "symbol" }).catch(() => undefined),
    pc.readContract({ address: checksummed, abi: erc20Abi, functionName: "name" }).catch(() => undefined),
  ]);
  const token = new Token(chainId, checksummed, Number(decimals), symbol as string | undefined, name as string | undefined);
  cache.set(key, token);
  return token;
}
