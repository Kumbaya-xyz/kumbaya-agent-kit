// Wallet auth/signing tests. SIWE + deposit hit live systems; run with a funded wallet:
//   npm run test:write
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyTypedData, getAddress } from "viem";
import { walletTools } from "../src/tools/wallet.js";
import { writeTools } from "../src/tools/writes.js";
import { readTools } from "../src/tools/reads.js";
import { requireAccount } from "../src/clients.js";

const funded = Boolean(process.env.WALLET_PRIVATE_KEY || process.env.AGENT_WALLET_KEY);
const skip = funded ? false : "set WALLET_PRIVATE_KEY (funded testnet wallet) to run wallet tests";

const wt = (n: string) => walletTools.find((t) => t.name === n)!.handler;
const wh = (n: string) => writeTools.find((t) => t.name === n)!.handler;
const WETH = "0x4200000000000000000000000000000000000006";

test("siwe_login authenticates the wallet and returns a JWT", { skip }, async () => {
  const s: any = await wt("siwe_login")({ chainId: 6343 });
  assert.equal(s.authenticated, true);
  assert.ok(typeof s.token === "string" && s.token.length > 40, "JWT returned");
  assert.equal(getAddress(s.address), requireAccount().address);
});

test("sign_typed_data produces a signature valid for the wallet", { skip }, async () => {
  const me = requireAccount().address;
  const td = {
    domain: { name: "FuelVault", version: "1", chainId: 6343, verifyingContract: "0x37494B27b429b539a4048D19de4a015025B07662" },
    types: {
      GiftPermit: [
        { name: "user", type: "address" },
        { name: "creator", type: "address" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "GiftPermit",
    message: { user: me, creator: "0x000000000000000000000000000000000000dEaD", token: WETH, amount: "1000000000000000000", deadline: "9999999999", nonce: "0" },
  };
  const r: any = await wt("sign_typed_data")({ typedData: td, chainId: 6343 });
  const valid = await verifyTypedData({
    address: me,
    domain: td.domain as any,
    types: td.types as any,
    primaryType: "GiftPermit",
    message: { ...td.message, amount: 1000000000000000000n, deadline: 9999999999n, nonce: 0n } as any,
    signature: r.signature,
  });
  assert.equal(valid, true, "signature recovers to the wallet");
});

test("deposit_credits funds the FuelVault credit balance for a freshly launched token", { skip }, async () => {
  const sym = "D" + String(Date.now()).slice(-6);
  const ig: any = await wh("ignite")({ name: `Dep ${sym}`, symbol: sym, chainId: 6343 });
  assert.equal(ig.status, "success");
  await wh("swap")({ tokenIn: WETH, tokenOut: ig.token, amountIn: "0.001", chainId: 6343 });
  const bal: any = await readTools.find((t) => t.name === "get_balance")!.handler({ token: ig.token, chainId: 6343 });
  const holdWhole = Math.floor(Number(bal.token.balance) / 2).toString();
  const d: any = await wt("deposit_credits")({ token: ig.token, amount: holdWhole, chainId: 6343 });
  assert.equal(d.status, "success");
  assert.ok(Number(d.creditBalance) > 0, "credit balance increased");
});
