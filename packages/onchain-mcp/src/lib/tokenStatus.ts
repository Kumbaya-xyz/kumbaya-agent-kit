// The agent's full on-chain stake in one token, plus a deterministic disposal verdict
// for memory pruning. A token you LAUNCHED (you are its vesting beneficiary) is kept
// forever — it keeps producing claimable fees, unlocking tips, and vesting. Any other
// token is disposable only when every stake is zero: wallet balance, tip credits,
// creator tip earnings (liquid + still-locked/vested), and liquidity positions.
import { erc20Abi, formatUnits, getAddress } from "viem";
import { publicClient } from "../clients.js";
import { getChain, type ChainId } from "../config/chains.js";
import { getToken } from "./tokens.js";
import { FUEL_VAULT_ABI, FIRE_TOKEN_ABI, NPM_ABI } from "./abis.js";

type Vesting = { total: bigint; released: bigint; releasable: bigint; locked: bigint; beneficiary: string; complete: boolean };

async function vestingOf(chainId: ChainId, token: `0x${string}`): Promise<Vesting | null> {
  const pc = publicClient(chainId);
  const read = (fn: string) => pc.readContract({ address: token, abi: FIRE_TOKEN_ABI, functionName: fn as never });
  try {
    const [total, vested, released, beneficiary, complete] = (await Promise.all([
      read("vestingTotal"),
      read("vestedAmount"),
      read("vestingReleased"),
      read("vestingBeneficiary"),
      read("vestingComplete"),
    ])) as [bigint, bigint, bigint, string, boolean];
    return {
      total,
      released,
      releasable: vested > released ? vested - released : 0n,
      locked: total > vested ? total - vested : 0n,
      beneficiary,
      complete,
    };
  } catch {
    return null; // not a Fire token with vesting
  }
}

async function liquidityInToken(chainId: ChainId, owner: `0x${string}`, token: `0x${string}`) {
  const npm = getChain(chainId).addresses.positionManager;
  const pc = publicClient(chainId);
  const count = Number(await pc.readContract({ address: npm, abi: NPM_ABI, functionName: "balanceOf", args: [owner] }));
  if (!count) return [] as Array<{ tokenId: string; liquidity: string }>;
  const ids = (await Promise.all(
    Array.from({ length: count }, (_, i) =>
      pc.readContract({ address: npm, abi: NPM_ABI, functionName: "tokenOfOwnerByIndex", args: [owner, BigInt(i)] }),
    ),
  )) as bigint[];
  const rows = await Promise.all(
    ids.map(async (id) => {
      const p = (await pc.readContract({ address: npm, abi: NPM_ABI, functionName: "positions", args: [id] })) as readonly unknown[];
      const t0 = String(p[2]).toLowerCase();
      const t1 = String(p[3]).toLowerCase();
      const liq = p[7] as bigint;
      const tk = token.toLowerCase();
      return liq > 0n && (t0 === tk || t1 === tk) ? { tokenId: id.toString(), liquidity: liq.toString() } : null;
    }),
  );
  return rows.filter((r): r is { tokenId: string; liquidity: string } => r !== null);
}

/** Pure disposal verdict — a token you launched is never disposable; otherwise every
 *  stake must be zero. Kept separate so the semantics are unit-testable. */
export function isDisposableStatus(v: {
  walletBal: bigint;
  credits: bigint;
  liquid: bigint;
  vested: bigint;
  positionCount: number;
  isCreator: boolean;
}): boolean {
  if (v.isCreator) return false;
  return v.walletBal === 0n && v.credits === 0n && v.liquid === 0n && v.vested === 0n && v.positionCount === 0;
}

export async function tokenStatus(chainId: ChainId, ownerInput: string, tokenInput: string) {
  const owner = getAddress(ownerInput);
  const token = await getToken(chainId, tokenInput);
  const tokenAddr = token.address as `0x${string}`;
  const dec = token.decimals;
  const vault = getChain(chainId).addresses.fuelVault;
  const pc = publicClient(chainId);

  const [walletBal, credits, bucket, vesting, positions] = await Promise.all([
    pc.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "balanceOf", args: [owner] }) as Promise<bigint>,
    pc.readContract({ address: vault, abi: FUEL_VAULT_ABI, functionName: "getCredits", args: [owner, tokenAddr] }) as Promise<bigint>,
    pc.readContract({ address: vault, abi: FUEL_VAULT_ABI, functionName: "getCreatorBucket", args: [owner, tokenAddr] }) as Promise<readonly [bigint, bigint, boolean]>,
    vestingOf(chainId, tokenAddr),
    liquidityInToken(chainId, owner, tokenAddr),
  ]);

  const [liquid, vested, unlocked] = bucket;
  const isCreator = !!vesting && vesting.beneficiary.toLowerCase() === owner.toLowerCase();
  const isDisposable = isDisposableStatus({ walletBal, credits, liquid, vested, positionCount: positions.length, isCreator });

  return {
    chainId,
    token: { address: token.address, symbol: token.symbol, decimals: dec },
    owner,
    walletBalance: formatUnits(walletBal, dec),
    tipCredits: formatUnits(credits, dec),
    creatorEarnings: { liquid: formatUnits(liquid, dec), vested: formatUnits(vested, dec), unlocked },
    liquidity: { positions: positions.length, items: positions },
    vesting: vesting
      ? {
          total: formatUnits(vesting.total, dec),
          released: formatUnits(vesting.released, dec),
          releasable: formatUnits(vesting.releasable, dec),
          locked: formatUnits(vesting.locked, dec),
          complete: vesting.complete,
        }
      : null,
    isCreator,
    isDisposable,
    verdict: isCreator
      ? "Token you launched — keep in memory forever (it keeps producing fees, tips, and vesting)."
      : isDisposable
        ? "No remaining stake — safe to forget."
        : "Still has balance, tip credits, creator earnings, or liquidity — keep tracking.",
  };
}
