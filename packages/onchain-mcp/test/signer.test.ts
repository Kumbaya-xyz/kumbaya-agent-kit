// Remote-signer end-to-end: one signer holds two agents' keys; each keyless MCP
// identity signs as itself. Agent A (funded) sends a REAL testnet swap via the
// signer. Run with a funded wallet: npm run test:write
import { test } from "node:test";
import assert from "node:assert/strict";
import { serve } from "@hono/node-server";
import { createApp } from "../../signer/src/app.ts";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { recoverTransactionAddress, getAddress } from "viem";

const rawKeyA = process.env.WALLET_PRIVATE_KEY || process.env.AGENT_WALLET_KEY || "";
const skip = rawKeyA ? false : "set WALLET_PRIVATE_KEY (funded testnet wallet) to run the signer test";
const KEYA = rawKeyA.startsWith("0x") ? rawKeyA : `0x${rawKeyA}`;
const PORT = 8899;

test("remote signer: two agents, one signer, keyless MCP signs a real swap as agent A", { skip }, async () => {
  const KEYB = generatePrivateKey();
  const addrA = privateKeyToAccount(KEYA as `0x${string}`).address;
  const addrB = privateKeyToAccount(KEYB).address;

  // The signer process holds both keys; the MCP process gets none.
  process.env.SIGNER_KEYS = JSON.stringify({ "tok-A": KEYA, "tok-B": KEYB });
  delete process.env.WALLET_PRIVATE_KEY;
  delete process.env.AGENT_WALLET_KEY;
  const server = serve({ fetch: createApp().fetch, port: PORT });
  const SIGNER = `http://localhost:${PORT}`;
  try {
    const addrOf = async (t: string) =>
      (await (await fetch(`${SIGNER}/v1/address`, { headers: { authorization: `Bearer ${t}` } })).json()).address;
    assert.equal(getAddress(await addrOf("tok-A")), getAddress(addrA), "tok-A resolves to agent A");
    assert.equal(getAddress(await addrOf("tok-B")), getAddress(addrB), "tok-B resolves to agent B");
    assert.notEqual(getAddress(addrA), getAddress(addrB), "distinct identities from one signer");

    // Agent A: keyless MCP (SIGNER_URL only) sends a real swap.
    process.env.SIGNER_URL = SIGNER;
    process.env.SIGNER_TOKEN = "tok-A";
    process.env.SIGNER_ADDRESS = addrA;
    const { writeTools } = await import("../src/tools/writes.js");
    const { publicClient } = await import("../src/clients.js");
    const swap = writeTools.find((t) => t.name === "swap")!.handler;
    const WETH = "0x4200000000000000000000000000000000000006";
    const USDT = "0x8E1eb0b74A0aC37abaa0f75C598A681975896900";
    const r: any = await swap({ tokenIn: WETH, tokenOut: USDT, amountIn: "0.0004", chainId: 6343 });
    assert.equal(r.status, "success", "swap confirmed");
    const rc = await publicClient(6343).getTransactionReceipt({ hash: r.txHash });
    assert.equal(getAddress(rc.from), getAddress(addrA), "on-chain sender is agent A (signed remotely)");

    // Agent B signs its own tx through the same signer; it recovers to agent B.
    const tx = { to: addrA, value: "0x0", nonce: 0, gas: "0x5208", maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x3b9aca00", chainId: 6343, type: "eip1559" };
    const signed = (await (
      await fetch(`${SIGNER}/v1/sign/transaction`, { method: "POST", headers: { authorization: "Bearer tok-B", "content-type": "application/json" }, body: JSON.stringify({ transaction: tx }) })
    ).json()).signedTransaction as `0x${string}`;
    const recovered = await recoverTransactionAddress({ serializedTransaction: signed });
    assert.equal(getAddress(recovered), getAddress(addrB), "agent B's signed tx recovers to agent B");
  } finally {
    server.close();
  }
});
