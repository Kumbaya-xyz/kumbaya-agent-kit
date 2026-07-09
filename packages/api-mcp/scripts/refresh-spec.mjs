#!/usr/bin/env node
// Re-fetch the live Kumbaya OpenAPI specs into src/specs/. Tools are generated
// from these, so refreshing them is all that's needed to track an API change.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SPECS = [
  ["exchange", process.env.KUMBAYA_EXCHANGE_URL || "https://exchange.kumbaya.xyz"],
  ["client", process.env.KUMBAYA_CLIENT_URL || "https://clients.kumbaya.xyz"],
  ["search", process.env.KUMBAYA_SEARCH_URL || "https://search.kumbaya.xyz"],
];
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "specs");

for (const [name, base] of SPECS) {
  const url = `${base.replace(/\/+$/, "")}/openapi.json`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to fetch ${url}: ${res.status}`);
    process.exit(1);
  }
  const spec = await res.json();
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(spec, null, 2) + "\n");
  const ops = Object.values(spec.paths).reduce(
    (n, m) => n + Object.keys(m).filter((k) => !k.startsWith("x-")).length,
    0
  );
  console.log(`${name}: ${spec.info.title} v${spec.info.version}, ${ops} operations`);
}
