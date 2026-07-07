#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildTools, SERVICE_NAMES, type BuildOptions } from "./spec.js";
import { callEndpoint, type ClientConfig } from "./client.js";

// Which services to expose. Default: all. e.g. KUMBAYA_MCP_SERVICES=exchange,search
const services = (process.env.KUMBAYA_MCP_SERVICES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const baseUrls: Record<string, string> = {};
if (process.env.KUMBAYA_EXCHANGE_URL) baseUrls.exchange = process.env.KUMBAYA_EXCHANGE_URL;
if (process.env.KUMBAYA_CLIENT_URL) baseUrls.client = process.env.KUMBAYA_CLIENT_URL;
if (process.env.KUMBAYA_SEARCH_URL) baseUrls.search = process.env.KUMBAYA_SEARCH_URL;

const buildOpts: BuildOptions = {
  services: services.length ? services : undefined,
  baseUrls,
};

const cfg: ClientConfig = {
  apiKey: process.env.KUMBAYA_API_KEY,
  jwt: process.env.KUMBAYA_JWT,
  jwtFile: process.env.KUMBAYA_JWT_FILE,
};

const tools = buildTools(buildOpts);
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
const enabled = services.length ? services.join(",") : SERVICE_NAMES.join(",");
console.error(
  `kumbaya-mcp ready — ${tools.length} tools across [${enabled}]${cfg.apiKey ? " +api-key" : ""}${cfg.jwt || cfg.jwtFile ? " +jwt" : ""}`
);
