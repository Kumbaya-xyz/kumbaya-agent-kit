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

const server = new McpServer({ name: "kumbaya-onchain-mcp", version: "0.1.0" });

const allTools: ToolDef[] = [...readTools, ...writeTools, ...walletTools];

for (const t of allTools) {
  server.tool(t.name, t.description, t.schema, async (args: unknown) => {
    try {
      return ok(await t.handler(args ?? {}));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return ok({ error: msg });
    }
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
