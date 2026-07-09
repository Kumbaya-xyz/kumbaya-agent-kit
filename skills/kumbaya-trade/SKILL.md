---
name: kumbaya-trade
description: Swap tokens on Kumbaya (Uniswap V3 on MegaETH) — quote first, then swap, including native ETH. Use when the user wants to buy/sell/swap a token or check a price/route.
---

# Kumbaya: trade

All tools are on **onchain-mcp**. Native ETH is represented by the WETH address `0x4200000000000000000000000000000000000006` — pass it as `tokenIn`/`tokenOut` to spend or receive native ETH.

## Quote before swapping

`quote` returns the best route and expected amounts. Provide exactly one of `amountIn` (exact-in) or `amountOut` (exact-out), in human units.

```
quote { tokenIn, tokenOut, amountIn: "0.5" }
```

Report the route and rate to the user before executing.

## Swap

`swap` sends the transaction. Same amount rules as `quote`. ERC-20 inputs are auto-approved to the router; native ETH needs no approval.

```
swap { tokenIn, tokenOut, amountIn: "0.5", slippageBps: 50 }
```

- `slippageBps` defaults to 50 (0.5%).
- Returns the route, amounts spent/received, and the transaction hash + explorer link.

## Notes

- Check `get_balance { token }` first if you're unsure the wallet holds enough.
- A freshly launched token may not be in the indexer yet; routing falls back to on-chain pool discovery, so swaps still work.
- Start on testnet (`chainId: 6343`) when experimenting.
