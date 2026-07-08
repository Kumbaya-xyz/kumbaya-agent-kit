// Real tests against MegaETH testnet (6343). No mocks — these hit the live RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readTools } from "../src/tools/reads.js";

const handler = (name: string) => {
  const t = readTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t.handler;
};

const WETH9 = "0x4200000000000000000000000000000000000006";

test("get_balance: live ETH balance for an address on testnet", async () => {
  const r: any = await handler("get_balance")({ address: WETH9, chainId: 6343 });
  assert.equal(r.chainId, 6343);
  assert.equal(r.address, WETH9);
  assert.match(r.eth, /^\d+(\.\d+)?$/, "eth is a decimal string");
  assert.ok(BigInt(r.ethWei) >= 0n, "ethWei parses to a bigint");
});

test("get_balance: live ERC-20 (WETH) metadata + balance on testnet", async () => {
  const r: any = await handler("get_balance")({ address: WETH9, token: WETH9, chainId: 6343 });
  assert.ok(r.token, "token block present");
  assert.equal(r.token.decimals, 18, "WETH has 18 decimals");
  assert.equal(typeof r.token.symbol, "string");
  assert.match(r.token.balance, /^\d+(\.\d+)?$/);
  assert.ok(BigInt(r.token.balanceRaw) >= 0n);
});

test("get_balance: rejects clearly with no address and no wallet", async () => {
  await assert.rejects(() => handler("get_balance")({ chainId: 6343 }), /no wallet|no address/i);
});

test("get_balance: rejects an invalid token address", async () => {
  await assert.rejects(
    () => handler("get_balance")({ address: WETH9, token: "not-an-address", chainId: 6343 }),
    /valid address/i
  );
});
