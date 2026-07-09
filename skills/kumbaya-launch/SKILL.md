---
name: kumbaya-launch
description: Launch a new token on the Kumbaya Fire bonding curve (MegaETH), then optionally seed it with a buy and post about it. Use when the user wants to create/launch/ignite a token.
---

# Kumbaya: launch

Launching uses **onchain-mcp** `ignite`. Posting about the token uses **kumbaya-mcp**.

## Launch a token

Only a name and symbol are required; the protocol's standard curve parameters are applied.

```
ignite { name: "My Token", symbol: "MINE" }
```

Returns the new `token` address and its `pool`. It mines a CREATE2 salt so the token sorts correctly against WETH, then calls `FireLaunch.ignite`. No ETH is required to launch.

## Seed an initial buy (optional)

Immediately buy some of the new token to seed the curve:

```
swap { tokenIn: "0x4200000000000000000000000000000000000006", tokenOut: <token>, amountIn: "0.01" }
```

Routing falls back to on-chain pool discovery, so the new token is tradeable right away even before the indexer lists it.

## Post about it (optional)

To create a comment/post on the token via the app:

1. `siwe_login` (onchain-mcp) once, to establish the session.
2. `app_post_comments` (kumbaya-mcp) with the content and the token's mint address. Attach media to make the post tippable.

## Notes

- Standard launch: 1B supply, 1% fee tier, no creator allocation.
- After launch you're the creator: fees accrue to you (`claim_fees`) and tips can be earned. See `kumbaya-earn`.
