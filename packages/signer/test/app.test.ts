// Signer service unit tests (no chain needed): auth, address, message + typed-data
// signing recover to the right key, and policy enforcement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { verifyMessage, verifyTypedData, getAddress } from "viem";
import { createApp } from "../src/app.ts";

const keyA = generatePrivateKey();
const keyB = generatePrivateKey();
const addrA = privateKeyToAccount(keyA).address;

function app() {
  process.env.SIGNER_KEYS = JSON.stringify({
    "tok-A": keyA,
    "tok-B": { key: keyB, label: "B", policy: { allowChains: [6343], maxValueWei: "1000000000000000", allowTo: ["0x0000000000000000000000000000000000000001"] } },
  });
  return createApp();
}
const req = (a: ReturnType<typeof createApp>, path: string, init?: RequestInit) => a.fetch(new Request(`http://x${path}`, init));

test("unauthorized without a valid token", async () => {
  const res = await req(app(), "/v1/address", { headers: { authorization: "Bearer nope" } });
  assert.equal(res.status, 401);
});

test("address resolves per token", async () => {
  const res = await req(app(), "/v1/address", { headers: { authorization: "Bearer tok-A" } });
  const { address } = (await res.json()) as { address: string };
  assert.equal(getAddress(address), getAddress(addrA));
});

test("message signature recovers to the token's key", async () => {
  const res = await req(app(), "/v1/sign/message", { method: "POST", headers: { authorization: "Bearer tok-A", "content-type": "application/json" }, body: JSON.stringify({ message: "hello kumbaya" }) });
  const { signature } = (await res.json()) as { signature: `0x${string}` };
  assert.ok(await verifyMessage({ address: addrA, message: "hello kumbaya", signature }));
});

test("typed-data signature (string uints) recovers to the key", async () => {
  const domain = { name: "FuelVault", version: "1", chainId: 6343, verifyingContract: "0x37494B27b429b539a4048D19de4a015025B07662" };
  const types = { GiftPermit: [{ name: "amount", type: "uint256" }, { name: "nonce", type: "uint256" }] };
  const typedData = { domain, types, primaryType: "GiftPermit", message: { amount: "0x0de0b6b3a7640000", nonce: "0x0" } };
  const res = await req(app(), "/v1/sign/typed-data", { method: "POST", headers: { authorization: "Bearer tok-A", "content-type": "application/json" }, body: JSON.stringify({ typedData }) });
  const { signature } = (await res.json()) as { signature: `0x${string}` };
  assert.ok(await verifyTypedData({ address: addrA, domain: domain as any, types: types as any, primaryType: "GiftPermit", message: { amount: 1000000000000000000n, nonce: 0n } as any, signature }));
});

test("policy denies a disallowed recipient", async () => {
  const tx = { to: "0x00000000000000000000000000000000000000ff", value: "0x0", nonce: 0, gas: "0x5208", maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x3b9aca00", chainId: 6343, type: "eip1559" };
  const res = await req(app(), "/v1/sign/transaction", { method: "POST", headers: { authorization: "Bearer tok-B", "content-type": "application/json" }, body: JSON.stringify({ transaction: tx }) });
  assert.equal(res.status, 403, "recipient not allowlisted");
});

test("policy denies over-cap value", async () => {
  const tx = { to: "0x0000000000000000000000000000000000000001", value: "0xde0b6b3a7640000", nonce: 0, gas: "0x5208", maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x3b9aca00", chainId: 6343, type: "eip1559" };
  const res = await req(app(), "/v1/sign/transaction", { method: "POST", headers: { authorization: "Bearer tok-B", "content-type": "application/json" }, body: JSON.stringify({ transaction: tx }) });
  assert.equal(res.status, 403, "value exceeds cap");
});
