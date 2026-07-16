// Offline unit tests for the token allowlist gate: WETH + self-launched bypass the
// registry; a token is allowed only if the search service returns it as trusted with
// an EXACT address match; unknowns and fuzzy-only hits are rejected; a search-service
// outage fails closed. Stubs global fetch, so it runs in its own isolated process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedToken, assertAllowedToken, markSelfLaunched } from "../src/lib/tokenAllowlist.ts";
import { getChain } from "../src/config/chains.ts";

const WETH = getChain(6343).addresses.weth9;
const TRUSTED = "0x1111111111111111111111111111111111111111";
const UNKNOWN = "0x2222222222222222222222222222222222222222";
const FUZZY_Q = "0x3333333333333333333333333333333333333333";
const OTHER = "0x3333333333333333333333333333333333330000";
const LAUNCHED = "0x4444444444444444444444444444444444444444";
const OUTAGE = "0x5555555555555555555555555555555555555555";

// Return the trusted tokens whose address exactly matches the query `q`.
const stubTrusted = (trusted: string[]) => {
  globalThis.fetch = (async (url: string) => {
    const q = (new URL(String(url)).searchParams.get("q") ?? "").toLowerCase();
    const tokens = trusted.filter((a) => a.toLowerCase() === q).map((a) => ({ address: a }));
    return new Response(JSON.stringify({ tokens }), { status: 200 });
  }) as typeof fetch;
};
const stubReturns = (tokens: unknown[]) => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ tokens }), { status: 200 })) as typeof fetch;
};
const stubDown = () => {
  globalThis.fetch = (async () => new Response("err", { status: 500 })) as typeof fetch;
};

test("WETH (routing numeraire) is always allowed, no registry call", async () => {
  stubDown();
  assert.equal(await isAllowedToken(6343, WETH), true);
});

test("a self-launched token is allowed before it is indexed", async () => {
  stubDown();
  markSelfLaunched(4326, LAUNCHED);
  assert.equal(await isAllowedToken(4326, LAUNCHED), true);
});

test("trusted token is allowed; unknown is rejected", async () => {
  stubTrusted([TRUSTED]);
  assert.equal(await isAllowedToken(6343, TRUSTED), true, "trusted");
  assert.equal(await isAllowedToken(6343, UNKNOWN), false, "unknown");
  await assert.rejects(() => assertAllowedToken(6343, UNKNOWN, "token"), /not allowlisted/);
});

test("a fuzzy hit without an exact address match is rejected", async () => {
  stubReturns([{ address: OTHER }]); // search returns a near-miss, not the queried address
  assert.equal(await isAllowedToken(6343, FUZZY_Q), false);
});

test("fails closed when the search service is unreachable", async () => {
  stubDown();
  await assert.rejects(() => assertAllowedToken(4326, OUTAGE, "token"), /Could not verify/);
});

test("KUMBAYA_TOKEN_ALLOWLIST=off allows any token, no registry call", async () => {
  stubDown(); // registry unreachable — must not matter when the guard is off
  process.env.KUMBAYA_TOKEN_ALLOWLIST = "off";
  try {
    await assert.doesNotReject(() => assertAllowedToken(6343, UNKNOWN, "token"));
  } finally {
    delete process.env.KUMBAYA_TOKEN_ALLOWLIST;
  }
});
