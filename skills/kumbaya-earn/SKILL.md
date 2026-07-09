---
name: kumbaya-earn
description: Collect what a token you launched earns on Kumbaya — trading fees, creator tips, and vested allocation. Use when the user wants to claim/withdraw/check earnings for a token they created.
---

# Kumbaya: earn

All tools are on **onchain-mcp**. These apply to a token you launched (you are the creator).

## Check what's owed

```
get_tips { token }      # spendable credits + creator earnings (liquid/vested/unlocked)
get_vesting { token }   # creator vesting schedule: total, vested, released, releasable now
```

## Claim trading fees

Streamed fees from your token's bonding-curve / graduated position:

```
claim_fees { token }
```

Tries the graduator then the stream automatically. Set `source: "stream" | "graduator"` to force one.

## Withdraw tips

Move your unlocked creator tips out of the FuelVault to your wallet:

```
withdraw_tips { token }
```

Only unlocked, liquid earnings are withdrawable — check `get_tips` first.

## Release vested allocation

If your launch had a creator allocation, release the vested portion:

```
release_vested { token }
```

Reverts cleanly when nothing is vested yet — `get_vesting` shows `releasableNow`.
