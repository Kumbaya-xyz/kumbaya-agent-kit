# kumbaya-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for the
**Kumbaya DEX API** on MegaETH. Gives any MCP client (Claude, Cursor, Hermes, etc.)
live access to swap quotes, pool data, token metrics, global stats, and user
positions.

The server is **generated directly from Kumbaya's OpenAPI spec**, so its tools
always match the real API. There are no hand-copied endpoint definitions to drift.

## Install

```bash
npx kumbaya-mcp
```

Or add it to your MCP client config:

```json
{
  "mcpServers": {
    "kumbaya": {
      "command": "npx",
      "args": ["-y", "kumbaya-mcp"],
      "env": {
        "KUMBAYA_API_KEY": "optional-partner-key"
      }
    }
  }
}
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `KUMBAYA_MCP_BASE_URL` | `https://exchange.kumbaya.xyz` | API base URL |
| `KUMBAYA_API_KEY` | (unset) | Partner API key, sent as `x-api-key`. Only needed for the quote endpoints (see below). |

## Chains

| Network | `chainId` |
| --- | --- |
| MegaETH Mainnet | `4326` |
| MegaETH Testnet | `6343` |

Every tool takes a `chainId` argument.

## Tools

All tools map 1:1 to Kumbaya Exchange API endpoints.

**Public (no key required):**

- Pools — `get_pools`, `get_pools_list`, `get_pools_metrics`, `get_pools_admitted`,
  `get_pools_by_pool_id`, and per-pool `..._timeseries`, `..._activity`, `..._ticks`,
  `..._positions`, `..._swaps`, `..._flow_chart`
- Tokens — `get_tokens_trending`, `get_tokens_bluechip`, `get_tokens_prices`,
  `get_tokens_fire_meta`, `get_tokens_by_token_id`, and per-token `..._history`,
  `..._swaps`, `..._eth_price`
- Stats & status — `get_stats_global`, `get_indexer_status`, `get_status`, `get_health`
- Positions — `get_users_by_owner_positions_active`

**Partner only (require an API key):**

- `get_quote`, `post_quote`, `get_quote_tokens`, `post_quote_open`

> The quote endpoints are gated behind a partner API key. "Open" means *no token
> allowlist*, not *no auth* — all quote routes need a key. Set `KUMBAYA_API_KEY`
> and **reach out to the Kumbaya team to request access.** Without a key these tools
> return `401 Invalid API key`.

## How it stays accurate

The bundled `src/openapi.json` is Kumbaya's live spec. To update after an API
change:

```bash
npm run refresh-spec   # re-fetches the spec, regenerates nothing else needed
```

## Develop

```bash
pnpm install
pnpm dev      # run from source (stdio)
pnpm build    # bundle to dist/
```

## License

MIT
