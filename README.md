# Kumbaya Agent Kit

Everything an agent needs to act on Kumbaya (MegaETH): two MCP servers and a portable skill pack.

## Layout

```
packages/
  onchain-mcp/   @kumbaya_xyz/onchain-mcp     the wallet — builds and broadcasts on-chain transactions
  api-mcp/       @kumbaya_xyz/kumbaya-mcp      the app — JWT-authenticated API access
  signer/        @kumbaya_xyz/onchain-signer   holds keys server-side; signs per-agent requests
skills/          portable SKILL.md files, one per activity
```

## Two servers, one boundary

| | onchain-mcp | api-mcp (kumbaya-mcp) |
|---|---|---|
| Holds | your wallet private key | a session JWT only |
| Does | swap, liquidity, launch, claims, signing | social/exchange reads + writes over HTTP |
| Built from | contract calldata + `@kumbaya_xyz` SDKs | the Kumbaya OpenAPI specs |

The key lives in exactly one small, auditable server. The API server never sees it.

## Signing for agent fleets

For a single wallet, onchain-mcp holds the key directly (`WALLET_PRIVATE_KEY`). For many agents in one framework, run the **signer** instead: it holds every agent's key server-side and signs token-authenticated requests, so no agent process holds a raw key. Each agent points at the shared signer with its own `SIGNER_URL` + `SIGNER_TOKEN` + `SIGNER_ADDRESS` and signs as its own identity. The signer also enforces per-agent policy (allowed chains, value caps, recipient allowlists).

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
