import { buildTools, type ToolDef } from "./spec.js";
import { callEndpoint } from "./client.js";

const CHAIN = "4326";
const WETH = "0x4200000000000000000000000000000000000006";
const DUMMY = "0x000000000000000000000000000000000000dEaD";
const tools = buildTools();
const T = (n: string) => tools.find((t) => t.name === n)!;
const call = (n: string, a: any) => callEndpoint({}, T(n), a);

function pick(o: any, ...keys: string[]): any {
  for (const k of keys) if (o && o[k] != null) return o[k];
  return undefined;
}

async function discover() {
  const ids: Record<string, any> = { owner: DUMMY };
  try {
    const tr: any = (await call("dex_get_tokens_trending", { chainId: CHAIN, limit: 5 })).data;
    const tk = tr?.tokens?.[0];
    if (tk) { ids.tokenId = tk.id; ids.tokenAddr = tk.address; }
  } catch {}
  try {
    const pm: any = (await call("dex_get_pools_metrics", { chainId: CHAIN, limit: 3 })).data;
    const pl = pm?.pools?.[0];
    if (pl) ids.poolId = pl.id;
  } catch {}
  try {
    const pos: any = ids.poolId ? (await call("dex_get_pools_by_pool_id_positions", { poolId: ids.poolId, chainId: CHAIN, limit: 5 })).data : null;
    const o = pick(pos?.positions?.[0] || pos?.[0], "owner", "ownerAddress");
    if (o) ids.owner = o;
  } catch {}
  // launchpad token mint via client-api public content/feed
  for (const [name, args] of [
    ["app_get_content_shills", { chainId: CHAIN, limit: 5 }],
    ["app_get_feed_content", { chainId: CHAIN, limit: 5 }],
    ["app_get_feed_dares_viral", { chainId: CHAIN, limit: 5 }],
  ] as [string, any][]) {
    if (ids.mint) break;
    try {
      const r: any = T(name) ? (await call(name, args)).data : null;
      const flat = JSON.stringify(r);
      const m = flat.match(/"mintAddress":"(0x[0-9a-fA-F]{40})"/);
      if (m) ids.mint = m[1];
    } catch {}
  }
  // real launchpad token via search (client-api tokens are Kumbaya tokens)
  try {
    const sr: any = (await call("search_get_search_tokens", { q: "a", chainId: CHAIN, limit: 3 })).data;
    const st = sr?.tokens?.[0];
    if (st?.address) ids.mint = st.address;
  } catch {}
  ids.tokenAddr = ids.tokenAddr || "0x6691D67Ece85Ed950244c2CB5848d6498134321f";
  ids.mint = ids.mint || ids.tokenAddr;
  // a real comment id + postNumber (yaps are comments)
  try {
    const y: any = (await call("app_get_content_yaps", { chainId: CHAIN, limit: 3 })).data;
    const yap = y?.yaps?.[0] || y?.[0] || y?.items?.[0];
    if (yap) {
      ids.commentId = yap.id;
      ids.postNumber = yap.postNumber;
      ids.mint = yap.mintAddress || yap.token?.mintAddress || yap.tokenMintAddress || ids.mint;
    }
  } catch {}
  // a badge id
  try {
    const b: any = (await call("app_get_badges", {})).data;
    const bd = Array.isArray(b) ? b[0] : b?.badges?.[0];
    if (bd?.id) ids.badgeId = bd.id;
  } catch {}
  return ids;
}

function argFor(param: string, ids: Record<string, any>): any {
  const p = param.toLowerCase();
  const m: Record<string, any> = {
    chainid: CHAIN, tokenindecimals: 18, tokenoutdecimals: 18,
    tokeninaddress: WETH, tokenoutaddress: ids.tokenAddr, fromtoken: WETH, totoken: ids.tokenAddr,
    amount: "10000000000000000", fromamount: "10000000000000000",
    recipient: DUMMY, owner: ids.owner, address: ids.owner, walletaddress: ids.owner,
    tokenid: ids.tokenId, poolid: ids.poolId, mintaddress: ids.mint,
    addresses: `${WETH},${ids.tokenAddr}`, username: "kumbaya",
    q: "weth", query: "weth", search: "weth", term: "weth",
    limit: 3, pagesize: 3, page: 1, offset: 0, days: 1, hours: 1, minutes: 60,
    id: ids.commentId, commentid: ids.commentId, postnumber: ids.postNumber, badgeid: ids.badgeId,
    txhash: "0x" + "0".repeat(64), granularity: "day", range: "1D",
    slippagebps: "50", slippage: 0.005, type: "exactIn", routertype: "swap-router-02",
  };
  return m[p];
}

function buildArgs(t: ToolDef, ids: Record<string, any>): { args: any; missing: string[] } {
  const args: any = {};
  const missing: string[] = [];
  for (const p of [...t.pathParams, ...t.queryParams, ...t.bodyProps]) {
    const v = argFor(p, ids);
    if (v !== undefined) args[p] = v;
    else if (t.pathParams.includes(p)) missing.push(p);
  }
  return { args, missing };
}

function verdict(t: ToolDef, status: number, missing: string[]): { tag: string; anomaly?: string } {
  const authExpected = t.auth !== "public";
  if (status === 401 || status === 403) {
    if (!authExpected) return { tag: "AUTH!", anomaly: `public tool got ${status} (needs auth — mislabeled?)` };
    return { tag: "auth-ok" };
  }
  if (status >= 200 && status < 300) {
    if (authExpected) return { tag: "OK", anomaly: `${t.auth} tool returned ${status} WITHOUT creds (auth not enforced?)` };
    return { tag: "OK" };
  }
  if (status === 400) return { tag: missing.length ? "reached(no-id/param)" : "reached(400)" };
  if (status === 404) return missing.length ? { tag: "reached(no-id)" } : { tag: "404", anomaly: t.pathParams.length ? undefined : "404 on non-parameterized endpoint (path bug?)" };
  if (status >= 500) return { tag: `${status}`, anomaly: `server ${status}` };
  return { tag: `${status}` };
}

const ids = await discover();
console.log("Discovered IDs:", JSON.stringify(ids));
console.log(`\nAuditing ${tools.length} tools (no credentials)\n`);

const anomalies: string[] = [];
const counts: Record<string, number> = {};
const rows: string[] = [];

for (const t of tools) {
  const { args, missing } = buildArgs(t, ids);
  let status = 0, err = "";
  try {
    const r = await callEndpoint({}, t, args);
    status = r.status;
  } catch (e: any) {
    err = e?.message ?? String(e);
  }
  if (err) {
    if (/Missing required path parameter/.test(err)) {
      rows.push(`  SKIP(no-id)  ${t.name}  (${missing.join(",")})`);
      counts["skip"] = (counts["skip"] || 0) + 1;
      continue;
    }
    anomalies.push(`WIRING ERR ${t.name}: ${err}`);
    counts["error"] = (counts["error"] || 0) + 1;
    rows.push(`  ERROR        ${t.name}  ${err}`);
    continue;
  }
  const v = verdict(t, status, missing);
  counts[v.tag] = (counts[v.tag] || 0) + 1;
  if (v.anomaly) anomalies.push(`${t.name} [${t.service}/${t.auth}] status=${status}: ${v.anomaly}`);
  rows.push(`  ${String(status).padEnd(3)} ${v.tag.padEnd(18)} ${t.name} [${t.auth}]`);
}

console.log(rows.join("\n"));
console.log("\n=== TALLY ===");
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
console.log(`\n=== ANOMALIES (${anomalies.length}) ===`);
console.log(anomalies.length ? anomalies.map((a) => "  ⚠ " + a).join("\n") : "  none");
