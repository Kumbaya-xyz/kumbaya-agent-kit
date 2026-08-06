---
name: kumbaya-launch
description: Launch a new token on the Kumbaya Fire bonding curve (MegaETH) with full metadata, then optionally seed a buy and post about it. Use when the user wants to create/launch/ignite a token.
---

# Kumbaya: launch

A token has two parts: the on-chain token+pool (onchain-mcp `ignite`) and the off-chain
listing metadata (name, image, description, socials) in the Kumbaya app (kumbaya-mcp). If you
only `ignite`, the token trades but shows as **UNCLAIMED** with no metadata. Use the full
launch flow below so the token is born with its metadata attached.

## Launch a token (use this flow)

Run `siwe_login` (onchain-mcp) once first so the app writes are authed. Then:

1. **Create the draft** with the metadata:
   `app_post_launch { name, symbol, chainId, description, category, website?, xHandle?, telegramUrl? }`
   returns the draft `id`. `category` is `MEMES` or `DARES`. Socials are optional; pass them
   here and they carry through to the listing on submit (no separate claim needed). `xHandle`
   is the handle without the `@`.
2. **Attach the image**: `app_post_launch_by_id_image { id, file: "<local image path>" }`.
3. **Deploy on-chain**: `ignite { name, symbol }` (onchain-mcp) returns the `token` address and
   `pool`. It mines a CREATE2 salt so the token sorts correctly against WETH, then calls
   `FireLaunch.ignite`. No ETH is required.
4. **Finalize**: `app_post_launch_by_id_submit { id, tokenAddress: <token> }`. The backend
   verifies you are the on-chain creator and attaches the metadata. The token is now claimed
   and fully listed. No signature is needed for this path.

## Claiming a token you already ignited (recovery)

If a token was created with a bare `ignite` (no draft), it is unclaimed and cannot be
submitted (there is no draft to submit against). Claim it instead: sign the proof with the
`sign_token_claim` helper (onchain-mcp), then `app_post_tokens_by_mint_address_claim` and
`app_post_tokens_by_mint_address_claim_image`. Load the **`kumbaya-claim`** skill for the
exact steps.

## Seed an initial buy (optional)

Buy some of the new token to seed the curve:

```
swap { tokenIn: "0x4200000000000000000000000000000000000006", tokenOut: <token>, amountIn: "0.01" }
```

Routing falls back to on-chain pool discovery, so the token is tradeable right away even
before the indexer lists it.

## Post about it (optional)

`app_post_comments` (kumbaya-mcp) with the content and the token's mint address. Attach media
to make the post tippable.

## Notes

- Standard launch: 1B supply, 1% fee tier, no creator allocation.
- As the creator you earn tips right away, but **trading fees only after the token graduates**
  (via FireStream). Pre-graduation, bonding-curve fees go to the protocol, not you.
  See `kumbaya-earn`.
- Always prefer the full launch flow over a bare `ignite`, so a token is never left unclaimed
  with no metadata.
