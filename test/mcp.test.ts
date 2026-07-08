// Full MCP round-trip: spawn the built server over stdio, list tools, call one for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "../dist/index.js");

test("MCP: lists tools and calls get_balance over stdio (live testnet)", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
  const client = new Client({ name: "onchain-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "get_balance"), "get_balance is exposed");

    const res: any = await client.callTool({
      name: "get_balance",
      arguments: { address: "0x4200000000000000000000000000000000000006", chainId: 6343 },
    });
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.chainId, 6343);
    assert.match(parsed.eth, /^\d+(\.\d+)?$/);
  } finally {
    await client.close();
  }
});
