# Kumbaya Agent Kit

Everything an agent needs to act on Kumbaya (MegaETH): two MCP servers, a signing service, and a portable skill pack.

## Layout

```
packages/
  onchain-mcp/   @kumbaya_xyz/onchain-mcp      the wallet — builds and broadcasts on-chain transactions
  api-mcp/       @kumbaya_xyz/kumbaya-mcp       the app — JWT-authenticated API access
  signer/        @kumbaya_xyz/onchain-signer    holds keys server-side; signs per-agent requests
skills/          portable SKILL.md files, one per activity
```

Each package publishes independently to npm; the monorepo shares docs and skills.

## Components

| | onchain-mcp | api-mcp (kumbaya-mcp) | signer |
|---|---|---|---|
| Role | build + broadcast on-chain txs, wallet auth | social/exchange reads + writes over HTTP | hold keys, sign per-agent requests |
| Holds | nothing, or one local key | a session JWT only | every agent's key |
| Built from | contract calldata + `@kumbaya_xyz` SDKs | the Kumbaya OpenAPI specs | viem |

The security boundary: whatever holds a private key does nothing else. For a single wallet that's onchain-mcp itself; for a fleet it's the signer, and the agent processes stay keyless.

## Tools

onchain-mcp:

- **Reads:** `get_balance`, `get_token`, `get_pool`, `quote`, `list_positions`, `get_tips`, `get_vesting`
- **Writes:** `swap`, `add_liquidity`, `remove_liquidity`, `collect_fees`, `ignite`, `claim_fees`, `withdraw_tips`, `release_vested`
- **Wallet:** `siwe_login`, `sign_typed_data`, `deposit_credits`

api-mcp exposes the Kumbaya exchange, search, and client (launchpad/social) APIs as tools, auto-generated from their OpenAPI specs and authenticated with a session JWT.

## Signing

For a single wallet, onchain-mcp signs directly with `WALLET_PRIVATE_KEY`.

For many agents in one framework, run the **signer**: it holds every agent's key and signs token-authenticated requests, so no agent process holds a raw key. Each agent points at the shared signer with its own `SIGNER_URL` + `SIGNER_TOKEN` + `SIGNER_ADDRESS` and signs as its own identity. The signer enforces per-agent policy (allowed chains, value caps, recipient allowlists) and tokens are revocable without touching keys.

## Auth bridge

Authenticated app actions need a session the wallet owns:

1. `siwe_login` (onchain-mcp) signs a Sign-In-With-Ethereum message and returns a JWT.
2. Point onchain-mcp and api-mcp at the same `KUMBAYA_JWT_FILE`. `siwe_login` writes the token there; api-mcp reads it on each request.

## Skills

The `skills/` pack turns tools into procedures — including cross-server ones like tipping. Drop them into an agent that supports skills (Claude Code, hermes, etc.).

- `kumbaya` — overview + which server to use.
- `kumbaya-trade` — quote and swap.
- `kumbaya-liquidity` — provide/adjust/collect liquidity.
- `kumbaya-launch` — launch a token on the Fire bonding curve.
- `kumbaya-tip` — tip a creator on a comment (spans both servers).
- `kumbaya-earn` — claim fees, withdraw tips, release vested allocation.

## Quick start

Register the servers with an MCP client (single-wallet example):

```json
{
  "mcpServers": {
    "kumbaya-onchain": {
      "command": "npx",
      "args": ["-y", "@kumbaya_xyz/onchain-mcp"],
      "env": { "WALLET_PRIVATE_KEY": "0x...", "CHAIN_ID": "6343", "KUMBAYA_JWT_FILE": "/path/session.jwt" }
    },
    "kumbaya-api": {
      "command": "npx",
      "args": ["-y", "@kumbaya_xyz/kumbaya-mcp"],
      "env": { "KUMBAYA_MCP_SERVICES": "exchange,search,client", "KUMBAYA_JWT_FILE": "/path/session.jwt" }
    }
  }
}
```

For a fleet, run `@kumbaya_xyz/onchain-signer` and swap onchain-mcp's `WALLET_PRIVATE_KEY` for `SIGNER_URL` + `SIGNER_TOKEN` + `SIGNER_ADDRESS`. See each package's README.

## Development

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm -r test          # per-package tests (reads/signing run against live testnet)
```

## Networks

MegaETH testnet `6343` (default) and mainnet `4326`.

## License

MIT
