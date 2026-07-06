# kumbaya-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for the
**Kumbaya platform** on MegaETH. Gives any MCP client (Claude, Cursor, Hermes,
etc.) live access to the DEX, the launchpad, social data, and search.

It covers three Kumbaya services, generated **directly from their OpenAPI specs**
so the tools always match the real APIs:

| Service | What | Tools |
| --- | --- | --- |
| `exchange` | DEX — swap quotes, pools, tokens, stats, positions | 29 |
| `client` | App — launchpad, tokens, comments, gifts/fuel, feed, content, competition, badges, users | 76 |
| `search` | Token & pool full-text search | 8 |

## Install

```bash
npx kumbaya-mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "kumbaya": {
      "command": "npx",
      "args": ["-y", "kumbaya-mcp"],
      "env": {
        "KUMBAYA_API_KEY": "optional-partner-key",
        "KUMBAYA_JWT": "optional-user-jwt"
      }
    }
  }
}
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `KUMBAYA_MCP_SERVICES` | all | Comma-list of services to expose, e.g. `exchange,search`. Trims the tool count. |
| `KUMBAYA_API_KEY` | (unset) | Partner API key (`x-api-key`) — required for the quote endpoints. |
| `KUMBAYA_JWT` | (unset) | User JWT (`Authorization: Bearer`) — required for authenticated client-api actions. |
| `KUMBAYA_EXCHANGE_URL` | `https://exchange.kumbaya.xyz` | Override exchange base URL |
| `KUMBAYA_CLIENT_URL` | `https://clients.kumbaya.xyz` | Override client base URL |
| `KUMBAYA_SEARCH_URL` | `https://search.kumbaya.xyz` | Override search base URL |

## Chains

`4326` = MegaETH Mainnet, `6343` = MegaETH Testnet. DEX and search tools take a
`chainId`.

## Authentication, by tier

- **Public** — most reads (pools, tokens, stats, positions, feed, content, search).
  No credentials.
- **Partner key** (`KUMBAYA_API_KEY`) — the four quote endpoints: `dex_get_quote`,
  `dex_post_quote`, `dex_post_quote_open`, `dex_get_quote_tokens`. Without a key
  they return `401 Invalid API key`. "Open" means the token allowlist is off, not
  no-auth. **Request a key from the Kumbaya team.**
- **User JWT** (`KUMBAYA_JWT`) — authenticated client-api actions (create a launch,
  post a comment, send a gift, edit your profile, etc.). Without a token they
  return `401 Authentication required`.

Tool descriptions carry a `[PARTNER ONLY: ...]` or `[Requires authentication: ...]`
tag so clients know which credential a tool needs.

> **Getting a JWT.** Client-api auth is a JWT issued via Privy or Sign-In With
> Ethereum (SIWE). This server does not sign for you — it takes a JWT you already
> hold via `KUMBAYA_JWT`. The SIWE endpoints (`app_post_session_nonce`,
> `app_post_session_verify`) are exposed as tools if you drive the flow yourself.

Internal/privileged endpoints (admin, webhooks, analytics, monitoring) are
excluded.

## Keeping it accurate

The bundled specs in `src/specs/` are the live Kumbaya OpenAPI documents. Refresh
after an API change:

```bash
npm run refresh-spec
```

## Develop

```bash
pnpm install
pnpm dev      # run from source (stdio)
pnpm build    # bundle to dist/
```

## License

MIT
