#!/usr/bin/env node
// Re-fetch the live Kumbaya Exchange OpenAPI spec into src/openapi.json.
// The MCP tools are generated from this file, so refreshing it is all that's
// needed to track an API change.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.KUMBAYA_MCP_BASE_URL || "https://exchange.kumbaya.xyz";
const url = `${BASE.replace(/\/+$/, "")}/openapi.json`;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "openapi.json");

const res = await fetch(url);
if (!res.ok) {
  console.error(`Failed to fetch ${url}: ${res.status}`);
  process.exit(1);
}
const spec = await res.json();
writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");
const ops = Object.values(spec.paths).reduce(
  (n, m) => n + Object.keys(m).filter((k) => !k.startsWith("x-")).length,
  0
);
console.log(`Wrote ${out}: ${spec.info.title} v${spec.info.version}, ${ops} operations`);
