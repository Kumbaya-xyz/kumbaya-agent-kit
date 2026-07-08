# @kumbaya_xyz/onchain-mcp

MCP server for on-chain Kumbaya actions on MegaETH — swaps, liquidity, token launch (Fire protocol), tips, and reads. Signs with a wallet key **you** control (never persisted). Testnet-first by default.

Built on the published `@kumbaya_xyz` SDKs (`sdk-core`, `v3-sdk`, `router-sdk`) + viem. Routing uses the public `pools/admitted` endpoint (no API key) plus client-side quoting.

## Config (env)
- `WALLET_PRIVATE_KEY` — signer for write actions. Omit for read-only mode.
- `CHAIN_ID` — `6343` testnet (default) or `4326` mainnet.
- `KUMBAYA_EXCHANGE_URL` / `KUMBAYA_CLIENT_URL` — API overrides (defaults to production).

## Dev
```
npm install
npm run build
npm test        # runs against live MegaETH testnet
```

Status: scaffolding + reads in progress. See TOOLS below as they land.
