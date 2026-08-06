---
name: kumbaya-claim
description: Claim an unclaimed Kumbaya token listing by proving on-chain creator ownership, then set its description, image, and socials. Use when a token was created with a bare ignite and shows as UNCLAIMED.
---

# Kumbaya: claim a token listing

A token created with a bare `ignite` (onchain-mcp) exists on-chain but has no off-chain
listing metadata, so it shows as **UNCLAIMED**. Claiming attaches the description, image,
and socials by proving you are the on-chain creator with an EIP-712 signature. (Tokens
launched via the full `kumbaya-launch` flow are already claimed; this path is only for
recovering a bare ignite.)

## Steps

1. `siwe_login` (onchain-mcp) once, so the app writes are authed.
2. **Sign the claim proof** with the helper (no hand-built typed data):
   `sign_token_claim { mintAddress: <token>, chainId }`
   returns `{ mintAddress, chainId, signature, signedAt, nonce }`.
3. **Submit the listing metadata** (kumbaya-mcp), passing the step-2 fields straight through:
   `app_post_tokens_by_mint_address_claim { mintAddress, chainId, description, category, signature, signedAt, nonce, website?, xHandle?, telegramUrl? }`.
   `description` and `category` (`MEMES` or `DARES`) are required. `name` is NOT set here; it
   comes from the on-chain token.
4. **Upload the image**:
   `app_post_tokens_by_mint_address_claim_image { mintAddress, file: "<local image path>" }`.

## Notes

- The signature expires after 1 hour, so sign (step 2) and claim (step 3) in the same run.
- Only the on-chain creator (your wallet) can claim: the backend recovers the signer from
  the signature and checks it matches the token's creator.
- Prefer launching via `kumbaya-launch` (the `/v1/launch` flow) so tokens are born claimed
  and you never need this recovery path.
