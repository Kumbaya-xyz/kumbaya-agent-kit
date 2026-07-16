// Disposal semantics for memory pruning. The on-chain aggregation in tokenStatus() is
// covered by live tests; here we lock the pure verdict: launched tokens are never
// disposable, and any remaining stake keeps a token tracked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDisposableStatus } from "../src/lib/tokenStatus.ts";

const ZERO = { walletBal: 0n, credits: 0n, liquid: 0n, vested: 0n, positionCount: 0, isCreator: false };

test("a token you launched is never disposable, even fully drained", () => {
  assert.equal(isDisposableStatus({ ...ZERO, isCreator: true }), false);
});

test("a non-creator token with every stake at zero is disposable", () => {
  assert.equal(isDisposableStatus(ZERO), true);
});

test("any single remaining stake blocks disposal", () => {
  assert.equal(isDisposableStatus({ ...ZERO, walletBal: 1n }), false, "wallet balance");
  assert.equal(isDisposableStatus({ ...ZERO, credits: 1n }), false, "tip credits");
  assert.equal(isDisposableStatus({ ...ZERO, liquid: 1n }), false, "liquid earnings");
  assert.equal(isDisposableStatus({ ...ZERO, vested: 1n }), false, "vested/locked earnings");
  assert.equal(isDisposableStatus({ ...ZERO, positionCount: 1 }), false, "liquidity position");
});
