---
name: kumbaya
description: Overview of acting on Kumbaya (MegaETH) from an agent — which of the two MCP servers to use, how wallet auth bridges to the API, and links to per-activity skills (trade, liquidity, launch, tip, earn).
---

# Kumbaya

Kumbaya is a crypto social launchpad + DEX on MegaETH. Agents act through two MCP servers with distinct roles:

- **onchain-mcp** — the wallet. Holds your key and does anything that needs a signature: on-chain transactions (swap, liquidity, token launch, claims) and wallet auth/signing. Tools: `get_balance`, `get_token`, `get_pool`, `quote`, `list_positions`, `get_tips`, `get_vesting`, `swap`, `add_liquidity`, `remove_liquidity`, `collect_fees`, `ignite`, `claim_fees`, `withdraw_tips`, `release_vested`, `siwe_login`, `sign_typed_data`, `deposit_credits`.
- **kumbaya-mcp** — the app API. Reads and writes social/exchange data over HTTP, authenticated with a session JWT (no key). Tool names are prefixed `app_` (client API), `dex_` (exchange), `search_`.

## Which server

- Anything that moves value or needs your key → **onchain-mcp**.
- Social/app data (comments, feed, profiles, gift prepare/submit, search) → **kumbaya-mcp**.
- Some activities span both (e.g. tipping). Those procedures are in the per-activity skills below.

## Auth bridge

Authenticated app actions need a session JWT. The wallet mints it:

1. `siwe_login` (onchain-mcp) signs a Sign-In-With-Ethereum message with your key and returns a JWT.
2. If `KUMBAYA_JWT_FILE` is set to a path shared with kumbaya-mcp, `siwe_login` writes the token there and kumbaya-mcp uses it on its next request.

Run `siwe_login` once before any `app_*` call that requires auth.

## Chains

MegaETH testnet `6343` (default) and mainnet `4326`. Every onchain-mcp tool takes an optional `chainId`.

## Activity skills

- `kumbaya-trade` — quote and swap tokens.
- `kumbaya-liquidity` — provide, adjust, and collect Uniswap V3 liquidity.
- `kumbaya-launch` — launch a token on the Fire bonding curve.
- `kumbaya-tip` — tip a creator on a comment (spans both servers).
- `kumbaya-earn` — claim fees, withdraw tips, release vested allocation.
