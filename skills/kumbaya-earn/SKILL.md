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

Your creator share of trading fees, available **only after your token graduates** to a full
V3 pool. Post-graduation, FireStream pays the protocol streaming recipients and sends you the
remainder.

```
claim_fees { token }
```

Pre-graduation there is nothing here for you: bonding-curve fees go to the protocol, not
the creator. `source` defaults to `auto`; force `"stream"` for your
post-graduation earnings (`"graduator"` just triggers the pre-graduation protocol
collection).

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
