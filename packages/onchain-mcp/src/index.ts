#!/usr/bin/env node
// Kumbaya on-chain MCP for MegaETH: swap, liquidity, token launch (Fire), reads,
// plus wallet auth/signing. Signs with a wallet key you control (WALLET_PRIVATE_KEY).
// Testnet-first by default.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ok, type ToolDef } from "./tools/registry.js";
import { readTools } from "./tools/reads.js";
import { writeTools } from "./tools/writes.js";
import { walletTools } from "./tools/wallet.js";
import { initWallet } from "./remoteAccount.js";

const server = new McpServer({ name: "kumbaya-onchain-mcp", version: "0.2.1" });

const allTools: ToolDef[] = [...readTools, ...writeTools, ...walletTools];

for (const t of allTools) {
  server.tool(t.name, t.description, t.schema, async (args: unknown) => {
    try {
      return ok(await t.handler(args ?? {}));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
      const detail = cause?.code ?? cause?.message;
      // No top-level "error" key: host circuit breakers (e.g. Hermes) treat that
      // as a server outage and lock every tool for a cooldown.
      return ok({ failed: true, reason: detail ? `${msg} (${detail})` : msg });
    }
  });
}

// Resolve the wallet address (from the signer's /v1/address) before serving, so a
// keyless agent that sets only SIGNER_URL + SIGNER_TOKEN knows who it is.
await initWallet();

const transport = new StdioServerTransport();
await server.connect(transport);
