// Address resolution for the remote signer: no signer -> null; explicit SIGNER_ADDRESS
// is used as-is (no network); otherwise initWallet() derives the address from the
// signer's /v1/address (the path Kumbaya agents use); unresolved -> clear throw.
// Ordered so the derived-address cache is only populated by the last test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { remoteAccount, initWallet } from "../src/remoteAccount.ts";

const ADDR = "0x1234567890123456789012345678901234567890";

test("no signer configured -> null (local-key / read-only mode)", async () => {
  delete process.env.SIGNER_URL;
  delete process.env.SIGNER_ADDRESS;
  assert.equal(remoteAccount(), null);
});

test("signer set but address unresolved -> clear throw", async () => {
  process.env.SIGNER_URL = "https://signer.internal";
  process.env.SIGNER_TOKEN = "tok-1";
  delete process.env.SIGNER_ADDRESS;
  assert.throws(() => remoteAccount(), /address unresolved/i);
});

test("explicit SIGNER_ADDRESS is used with no network call", async () => {
  process.env.SIGNER_URL = "https://signer.internal";
  process.env.SIGNER_ADDRESS = ADDR;
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  await initWallet(); // no-op when SIGNER_ADDRESS is set
  const a = remoteAccount();
  assert.equal(a?.address, ADDR);
  assert.equal(fetched, false, "SIGNER_ADDRESS present -> no /v1/address call");
});

test("initWallet derives the address from /v1/address (Bearer token)", async () => {
  process.env.SIGNER_URL = "https://signer.internal/";
  process.env.SIGNER_TOKEN = "tok-xyz";
  delete process.env.SIGNER_ADDRESS;
  let seenUrl = "";
  let seenAuth = "";
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    seenUrl = String(url);
    seenAuth = init?.headers?.authorization ?? "";
    return new Response(JSON.stringify({ address: ADDR, label: "kumbaya" }), { status: 200 });
  }) as typeof fetch;

  await initWallet();
  assert.equal(seenUrl, "https://signer.internal/v1/address");
  assert.equal(seenAuth, "Bearer tok-xyz");
  assert.equal(remoteAccount()?.address, ADDR);
});
