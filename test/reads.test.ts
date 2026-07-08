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

// Real testnet pool discovered via the public exchange API.
const WBTC = "0x59cB6631689f6627D8b7ef6B3412F7F8d12fB86e";
const USDT = "0x8E1eb0b74A0aC37abaa0f75C598A681975896900";
const WBTC_USDT_POOL = "0xb87831203D3C67109A2082e16a62C3004e98A025";

test("get_token: live WBTC metadata on testnet", async () => {
  const r: any = await handler("get_token")({ token: WBTC, chainId: 6343 });
  assert.equal(r.symbol, "WBTC");
  assert.ok(Number.isInteger(r.decimals) && r.decimals > 0);
  assert.match(r.totalSupply, /^\d/);
  assert.ok(BigInt(r.totalSupplyRaw) > 0n);
});

test("get_pool: computePoolAddress matches the real on-chain pool (custom init hash)", async () => {
  const r: any = await handler("get_pool")({ tokenA: WBTC, tokenB: USDT, fee: 3000, chainId: 6343 });
  assert.equal(r.exists, true, "pool exists on testnet");
  assert.equal(r.address.toLowerCase(), WBTC_USDT_POOL.toLowerCase(), "address matches the real pool");
  assert.ok(BigInt(r.liquidity) > 0n, "pool has liquidity");
  assert.ok(Number.isInteger(r.tick));
  assert.ok(r.price, "price both directions present");
});

test("get_pool: token order does not change the pool address", async () => {
  const a: any = await handler("get_pool")({ tokenA: WBTC, tokenB: USDT, fee: 3000, chainId: 6343 });
  const b: any = await handler("get_pool")({ tokenA: USDT, tokenB: WBTC, fee: 3000, chainId: 6343 });
  assert.equal(a.address, b.address);
});

const WETH = "0x4200000000000000000000000000000000000006";

test("quote: direct route WBTC->USDT returns a positive amount", async () => {
  const r: any = await handler("quote")({ tokenIn: WBTC, tokenOut: USDT, amountIn: "0.001", chainId: 6343 });
  assert.ok(Number(r.amountOut) > 0, "positive amountOut");
  assert.ok(BigInt(r.amountOutRaw) > 0n);
  assert.equal(r.route, "WBTC -> USDT", "picks the direct route");
});

test("quote: finds a multi-hop route WETH->WBTC (no direct pool)", async () => {
  const r: any = await handler("quote")({ tokenIn: WETH, tokenOut: WBTC, amountIn: "0.01", chainId: 6343 });
  assert.ok(Number(r.amountOut) > 0, "positive amountOut via multi-hop");
  assert.ok(r.route.split("->").length >= 2, "route has at least one hop");
});

test("quote: exact-out (amountOut) also resolves", async () => {
  const r: any = await handler("quote")({ tokenIn: WBTC, tokenOut: USDT, amountOut: "10", chainId: 6343 });
  assert.ok(Number(r.amountIn) > 0, "positive amountIn for exact-out");
  assert.equal(r.amountOut, "10");
});

test("quote: requires exactly one of amountIn/amountOut", async () => {
  await assert.rejects(() => handler("quote")({ tokenIn: WETH, tokenOut: WBTC, chainId: 6343 }), /exactly one/i);
  await assert.rejects(
    () => handler("quote")({ tokenIn: WETH, tokenOut: WBTC, amountIn: "1", amountOut: "1", chainId: 6343 }),
    /exactly one/i
  );
});
