---
name: kumbaya-tip
description: Tip (gift) a creator on a Kumbaya comment. Spans both MCP servers — the wallet signs, the app API prepares and submits. Use when the user wants to tip/gift a comment or creator.
---

# Kumbaya: tip

Tips are comment-specific: the recipient is the comment's author and the tip is denominated in the comment's launched token. You cannot tip your own comment. This procedure uses **both** servers.

## Procedure

1. **Authenticate** (once per session) — onchain-mcp:
   ```
   siwe_login
   ```
   Establishes the session JWT the app API needs.

2. **Prepare the gift** — kumbaya-mcp:
   ```
   app_get_gifts_prepare { commentId, chainId, units }
   ```
   `units` is 0.1–100 (0.1 steps). Returns `permit` (user, creator, token, amount, deadline, nonce) and `typedData` to sign.

3. **Fund credits if needed** — onchain-mcp. Tips spend FuelVault credits in the comment's token:
   ```
   get_tips { token: <permit.token> }          # read spendableCredits
   deposit_credits { token: <permit.token>, amount }   # only if credits < permit.amount; wallet must hold the token
   ```

4. **Sign the permit** — onchain-mcp:
   ```
   sign_typed_data { typedData: <from step 2> }   # returns signature
   ```

5. **Submit** — kumbaya-mcp:
   ```
   app_post_gifts { commentId, chainId, units, permit, signature }
   ```
   Returns the transaction hash and records the tip.

## Notes

- The app derives creator + token from the comment; never set them yourself.
- To have something to tip, a comment must have media. Create one with `app_post_comments` (see `kumbaya-launch`).
- Check `app_get_gifts_status` for the user's current fuel/credit standing and rate limits.
