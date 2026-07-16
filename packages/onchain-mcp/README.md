# @kumbaya_xyz/onchain-mcp

An MCP server for on-chain actions on Kumbaya (MegaETH). It signs transactions with a wallet key you control and covers trading, liquidity, token launches (Fire), and reads. Testnet-first by default.

For social/API actions (tipping comments, profiles, feeds), use `kumbaya-mcp`. This server is strictly on-chain.

Built on the published `@kumbaya_xyz` SDKs (`sdk-core`, `v3-sdk`, `router-sdk`) and viem.

## Install

```bash
npm install -g @kumbaya_xyz/onchain-mcp
# or run directly
npx @kumbaya_xyz/onchain-mcp
```

## Configuration

Signing works one of two ways: a local key for a single wallet, or a remote signer so the process holds no key (recommended for agent fleets — see `@kumbaya_xyz/onchain-signer`).

| Variable | Required | Purpose |
|----------|----------|---------|
| `WALLET_PRIVATE_KEY` | local mode | Hex private key used to sign transactions. Reads work without it. |
| `SIGNER_URL` | remote mode | Base URL of the signing service. When set, the process holds no key and delegates signing. |
| `SIGNER_TOKEN` | remote mode | This agent's bearer token at the signer. |
| `SIGNER_ADDRESS` | no | This agent's public address. Derived from the signer's `/v1/address` when omitted. |
| `CHAIN_ID` | no | Default chain: `6343` (MegaETH testnet, default) or `4326` (mainnet). Each tool also accepts an optional `chainId`. |
| `KUMBAYA_EXCHANGE_URL` | no | Override the exchange API used for pool discovery during routing. |
| `KUMBAYA_TOKEN_ALLOWLIST` | no | Set to `off` to disable the token allowlist and operate on any token. Defaults to on. |
| `KUMBAYA_SEARCH_URL` | no | Override the search API used to classify tokens as launchpad, bluechip, or verified. |
| `KUMBAYA_BLOCKSCOUT_4326` | no | Override the mainnet block explorer used to discover an address's token holdings. |
| `KUMBAYA_BLOCKSCOUT_6343` | no | Override the testnet block explorer used to discover an address's token holdings. |

Remote mode lets many agents share one signer while each signs as its own identity, keeping raw keys out of every agent process.

Register with an MCP client (Claude Desktop example):

```json
{
  "mcpServers": {
    "kumbaya-onchain": {
      "command": "npx",
      "args": ["-y", "@kumbaya_xyz/onchain-mcp"],
      "env": {
        "WALLET_PRIVATE_KEY": "0x...",
        "CHAIN_ID": "6343"
      }
    }
  }
}
```

## Tools

### Reads

| Tool | Description |
|------|-------------|
| `get_address` | Your wallet address (the account the signer holds). |
| `get_balance` | ETH and optional ERC-20 balance for an address. |
| `list_balances` | All ERC-20 balances for an address plus ETH, discovered via the block explorer and verified on-chain. |
| `get_token` | ERC-20 metadata and total supply. |
| `get_pool` | V3 pool state for a pair + fee tier: address, price, tick, liquidity. |
| `quote` | Best swap route and amounts between two tokens (exact-in or exact-out). |
| `list_positions` | V3 liquidity positions for an address: range, amounts, uncollected fees. |
| `get_tips` | FuelVault balances for a token: your spendable credits and creator earnings (liquid/vested). |
| `get_vesting` | Creator vesting schedule for a launched Fire token. |
| `token_status` | Your full stake in a token — balance, tip credits, creator earnings, liquidity, and vesting — with `isCreator` and `isDisposable` flags. |

### Writes

| Tool | Description |
|------|-------------|
| `swap` | Swap tokens (native ETH via the WETH address). ERC-20 inputs are auto-approved. |
| `add_liquidity` | Mint a V3 position (full range by default, or a custom tick range). |
| `remove_liquidity` | Withdraw principal + fees from a position; burns the NFT at 100%. |
| `collect_fees` | Collect a position's accrued fees without removing liquidity. |
| `ignite` | Launch a new token on the Fire bonding curve. Returns the token + pool. |
| `claim_fees` | Claim streamed trading fees for a token you launched. |
| `withdraw_tips` | Withdraw your unlocked creator tips for a token from the FuelVault. |
| `release_vested` | Release your vested creator allocation for a launched token. |

Routing discovers candidate pools from the public `pools/admitted` endpoint (no API key) and falls back to on-chain pool probing for tokens the indexer hasn't listed yet.

## Networks

| Network | Chain ID | Explorer |
|---------|----------|----------|
| MegaETH Mainnet | 4326 | https://megaeth.blockscout.com |
| MegaETH Testnet | 6343 | https://testnet-mega.etherscan.io |

## Development

```bash
npm install
npm run build       # bundle to dist/
npm run typecheck
npm test            # read + MCP stdio tests (live testnet, no wallet needed)
npm run test:write  # write tests — sends real testnet transactions (needs a funded WALLET_PRIVATE_KEY in .env)
```

Reads are validated against live testnet. Writes are validated with real testnet transactions.

## Safety

- The wallet key signs real transactions. Fund a dedicated key and start on testnet.
- Swaps, liquidity, and launches move real value. Review each tool's inputs before running against mainnet.
- `swap`, `add_liquidity`, and `deposit_credits` operate only on launchpad, bluechip, or verified tokens (per the Kumbaya token directory), plus a token launched in the same session. Unrecognized tokens are rejected. Set `KUMBAYA_TOKEN_ALLOWLIST=off` to operate on any token.

## License

MIT
