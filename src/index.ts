#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildTools, SPEC_INFO } from "./spec.js";
import { callEndpoint, type ClientConfig } from "./client.js";

const cfg: ClientConfig = {
  baseUrl: process.env.KUMBAYA_MCP_BASE_URL || SPEC_INFO.server || "https://exchange.kumbaya.xyz",
  apiKey: process.env.KUMBAYA_API_KEY,
};

const tools = buildTools();
const byName = new Map(tools.map((t) => [t.name, t]));

const server = new Server(
  { name: "kumbaya-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = byName.get(req.params.name);
  if (!tool) {
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }] };
  }
  try {
    const r = await callEndpoint(cfg, tool, (req.params.arguments as Record<string, any>) || {});
    return {
      isError: !r.ok,
      content: [{ type: "text", text: JSON.stringify({ status: r.status, data: r.data }, null, 2) }],
    };
  } catch (e: any) {
    return { isError: true, content: [{ type: "text", text: `Error: ${e?.message ?? String(e)}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `kumbaya-mcp ready — ${tools.length} tools from ${SPEC_INFO.title} v${SPEC_INFO.version}, base ${cfg.baseUrl}${cfg.apiKey ? " (api key set)" : ""}`
);
