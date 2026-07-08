// Write tests send REAL transactions on MegaETH testnet. Run with a funded wallet:
//   npm run test:write   (loads WALLET_PRIVATE_KEY from .env)
// Skipped (not faked) only when no wallet key is present — you cannot sign without one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readTools } from "../src/tools/reads.js";
import { writeTools } from "../src/tools/writes.js";

const funded = Boolean(process.env.WALLET_PRIVATE_KEY || process.env.AGENT_WALLET_KEY);
const skip = funded ? false : "set WALLET_PRIVATE_KEY (funded testnet wallet) to run write tests";

const rh = (n: string) => readTools.find((t) => t.name === n)!.handler;
const wh = (n: string) => writeTools.find((t) => t.name === n)!.handler;

const WETH = "0x4200000000000000000000000000000000000006";
const USDT = "0x8E1eb0b74A0aC37abaa0f75C598A681975896900";

test("swap: live native ETH -> USDT on testnet increases USDT balance", { skip }, async () => {
  const before: any = await rh("get_balance")({ token: USDT, chainId: 6343 });
  const r: any = await wh("swap")({ tokenIn: WETH, tokenOut: USDT, amountIn: "0.0005", chainId: 6343 });
  assert.equal(r.status, "success", "tx confirmed");
  assert.match(r.txHash, /^0x[0-9a-fA-F]{64}$/);
  assert.ok(r.route.includes("USDT"), "route ends at USDT");
  const after: any = await rh("get_balance")({ token: USDT, chainId: 6343 });
  assert.ok(
    Number(after.token.balance) > Number(before.token.balance),
    `USDT increased (${before.token.balance} -> ${after.token.balance})`
  );
});
