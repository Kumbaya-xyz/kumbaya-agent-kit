import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import type { Account } from "viem";

export interface Policy {
  maxValueWei?: string; // reject a tx sending more native value than this
  allowTo?: string[]; // if set, tx `to` must be in this list (lowercased)
  allowChains?: number[]; // if set, chainId must be in this list
}

export interface AgentEntry {
  account: Account;
  label?: string;
  policy?: Policy;
}

/**
 * Load the token -> {key, policy} map from SIGNER_KEYS (JSON) or SIGNER_KEYS_FILE.
 * Shape: { "<bearer-token>": { "key": "0x..", "label"?, "policy"? } }
 * A bare string value ("<token>": "0x..") is accepted as a key with no policy.
 */
export function loadKeystore(): Map<string, AgentEntry> {
  const raw = process.env.SIGNER_KEYS_FILE
    ? readFileSync(process.env.SIGNER_KEYS_FILE, "utf8")
    : process.env.SIGNER_KEYS || "{}";
  const parsed = JSON.parse(raw) as Record<string, string | { key: string; label?: string; policy?: Policy }>;
  const map = new Map<string, AgentEntry>();
  for (const [token, v] of Object.entries(parsed)) {
    const key = typeof v === "string" ? v : v.key;
    if (!key) continue;
    const pk = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
    map.set(token, {
      account: privateKeyToAccount(pk),
      label: typeof v === "string" ? undefined : v.label,
      policy: typeof v === "string" ? undefined : v.policy,
    });
  }
  return map;
}
