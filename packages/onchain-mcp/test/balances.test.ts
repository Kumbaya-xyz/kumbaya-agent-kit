// Offline unit tests for Blockscout token discovery (the external-dependency half of
// list_balances). The on-chain balance verification is trivial viem and is covered by
// live tests. Stubs global fetch, so it runs in its own isolated process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockscoutTokenList } from "../src/lib/balances.ts";

const ERC20_A = "0x1111111111111111111111111111111111111111";
const ERC20_B = "0x2222222222222222222222222222222222222222";
const NFT = "0x3333333333333333333333333333333333333333";

const stub = (body: unknown, status = 200) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
};

test("returns ERC-20 contract addresses, drops NFTs and invalid addresses", async () => {
  stub({
    status: "1",
    message: "OK",
    result: [
      { contractAddress: ERC20_A, type: "ERC-20" },
      { contractAddress: NFT, type: "ERC-721" },
      { contractAddress: "not-an-address", type: "ERC-20" },
      { contractAddress: ERC20_B, type: "ERC-20" },
    ],
  });
  const list = await blockscoutTokenList(6343, "0x0000000000000000000000000000000000000abc");
  assert.deepEqual(list, [ERC20_A, ERC20_B]);
});

test("empty on 'No token balance found'", async () => {
  stub({ status: "0", message: "No token balance found", result: [] });
  assert.deepEqual(await blockscoutTokenList(6343, ERC20_A), []);
});

test("empty (never throws) on a non-200 explorer response", async () => {
  stub("upstream error", 502);
  assert.deepEqual(await blockscoutTokenList(4326, ERC20_A), []);
});
