# Kumbaya Agent Kit

Everything an agent needs to act on Kumbaya (MegaETH): two MCP servers and a portable skill pack.

## Layout

```
packages/
  onchain-mcp/   @kumbaya_xyz/onchain-mcp   the wallet — signs and sends on-chain transactions
  api-mcp/       @kumbaya_xyz/kumbaya-mcp    the app — JWT-authenticated API access
skills/          portable SKILL.md files, one per activity
```

## Two servers, one boundary

| | onchain-mcp | api-mcp (kumbaya-mcp) |
|---|---|---|
| Holds | your wallet private key | a session JWT only |
| Does | swap, liquidity, launch, claims, signing | social/exchange reads + writes over HTTP |
| Built from | contract calldata + `@kumbaya_xyz` SDKs | the Kumbaya OpenAPI specs |

The key lives in exactly one small, auditable server. The API server never sees it.

## Auth bridge

Authenticated app actions need a session the wallet owns:

1. `siwe_login` (onchain-mcp) signs a Sign-In-With-Ethereum message and returns a JWT.
2. Point both servers at the same `KUMBAYA_JWT_FILE`. `siwe_login` writes the token there; api-mcp reads it on each request.

## Skills

The `skills/` pack turns tools into procedures — including cross-server ones like tipping. Drop them into an agent that supports skills (Claude Code, hermes, etc.).

- `kumbaya` — overview + which server to use.
- `kumbaya-trade` — quote and swap.
- `kumbaya-liquidity` — provide/adjust/collect liquidity.
- `kumbaya-launch` — launch a token on the Fire bonding curve.
- `kumbaya-tip` — tip a creator on a comment (spans both servers).
- `kumbaya-earn` — claim fees, withdraw tips, release vested allocation.

## Networks

MegaETH testnet `6343` (default) and mainnet `4326`.

## License

MIT
