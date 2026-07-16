# @kumbaya_xyz/onchain-signer

A per-agent signing service for Kumbaya on-chain actions. It holds wallet keys server-side and signs token-authenticated requests, so agent processes never hold a raw key. This lets many agents share one framework while each signs as its own identity.

Pairs with `@kumbaya_xyz/onchain-mcp`: the MCP builds transactions and delegates signing here.

## Model

- Each agent has a bearer **token**; the signer maps token → key.
- The MCP sends the prepared transaction (or typed data / message) with the agent's token; the signer signs with that agent's key and returns the signature. The MCP broadcasts.
- Raw keys live only in the signer. A leaked token is revocable/rotatable without touching the key.
- Per-agent **policy**: allowed chains, a native-value cap, a recipient allowlist, and a typed-data allowlist. Typed-data signing defaults to the FuelVault GiftPermit only.

## Configuration

| Variable | Purpose |
|----------|---------|
| `SIGNER_KEYS` | JSON map of token → key (or token → `{ key, label, policy }`). |
| `SIGNER_KEYS_FILE` | Path to a file containing that JSON (preferred over inline). |
| `PORT` | Listen port (default 8787). |

Keystore shape:

```json
{
  "agent-official-token": { "key": "0x<privkey>", "label": "official",
    "policy": { "allowChains": [6343], "maxValueWei": "50000000000000000",
                "allowTo": ["0x..router", "0x..positionManager"] } },
  "agent-ronnie-token": "0x<privkey>"
}
```

Policy fields are all optional: `allowChains`, `maxValueWei`, `allowTo`, and `allowTypedData` — a list of allowed EIP-712 shapes matched on `primaryType`/`name`/`version`/`verifyingContract`/`chainId`, each with an optional `spenderField` + `allowSpenders` list. When `allowTypedData` is unset, `/v1/sign/typed-data` signs only the FuelVault GiftPermit.

## Endpoints

All require `Authorization: Bearer <token>`.

| Method | Path | Body → Result |
|--------|------|---------------|
| GET | `/v1/address` | → `{ address, label }` |
| POST | `/v1/sign/transaction` | `{ transaction }` → `{ signedTransaction }` — policy-gated |
| POST | `/v1/sign/typed-data` | `{ typedData }` → `{ signature }` — policy-gated (default: GiftPermit only) |
| POST | `/v1/sign/message` | `{ message }` → `{ signature }` |
| GET | `/health` | → `{ ok, agents }` |

Bigints are transported as hex strings and restored server-side.

## Run

```bash
SIGNER_KEYS_FILE=./keys.json PORT=8787 npx @kumbaya_xyz/onchain-signer
```

Point each agent's onchain-mcp at it with `SIGNER_URL` and `SIGNER_TOKEN`. The address is derived from `/v1/address`; set `SIGNER_ADDRESS` to skip that lookup.

## Development

```bash
npm install
npm run build
npm run typecheck
npm test        # auth, address, message/typed-data signing, policy enforcement
```

## Security

- Run the signer on a trusted host; treat `SIGNER_KEYS`/`SIGNER_KEYS_FILE` as secrets.
- Give each agent its own token and a policy scoped to what it needs.
- Rotate a token by replacing it in the keystore; the underlying key is unaffected.

## License

MIT
