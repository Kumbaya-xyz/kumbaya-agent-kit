---
name: kumbaya-liquidity
description: Provide, view, adjust, and collect Uniswap V3 liquidity on Kumbaya (MegaETH). Use when the user wants to add/remove liquidity, open/close an LP position, or collect trading fees.
---

# Kumbaya: liquidity

All tools are on **onchain-mcp**. Positions are Uniswap V3 NFTs.

## View positions

```
list_positions            # all open positions for the wallet
list_positions { address } # for another address
```

Each entry has the pair, fee tier, tick range, in-range status, underlying amounts, and uncollected fees.

## Add liquidity

`add_liquidity` mints a new position. Provide the pair, fee tier, and the max amount of each token to deposit. Use the WETH address to deposit native ETH.

```
add_liquidity { tokenA, tokenB, fee: 10000, amountA: "0.01", amountB: "20" }
```

- Full range by default. Pass `tickLower` + `tickUpper` (aligned to the pool's spacing) for a concentrated range.
- ERC-20 sides are auto-approved. The actual amounts follow the pool ratio within the range.

## Collect fees

```
collect_fees { tokenId }
```

Collects accrued fees to the wallet without touching the position's liquidity.

## Remove liquidity

```
remove_liquidity { tokenId, percent: 100 }
```

Withdraws principal + fees. `percent: 100` also burns the empty NFT. `percent` defaults to 100.

## Notes

- Fee tiers: 100, 500, 3000, 10000 (hundredths of a bip).
- Check `get_pool { tokenA, tokenB, fee }` for current price/tick before choosing a range.
