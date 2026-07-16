import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import type { Account } from "viem";

// One allowed EIP-712 shape for /v1/sign/typed-data. A signing request must match
// at least one rule (all set fields must match) or it is rejected. Use it to pin
// signing to known permits (e.g. the GiftPermit domain, or Permit2 with a known spender).
export interface TypedDataRule {
  primaryType?: string; // exact match on the EIP-712 primaryType
  name?: string; // exact match on domain.name (e.g. "FuelVault")
  version?: string; // exact match on domain.version
  verifyingContract?: string; // exact match (lowercased) on domain.verifyingContract
  chainId?: number; // exact match on domain.chainId
  spenderField?: string; // name of the message field holding the spender/operator
  allowSpenders?: string[]; // if spenderField set, message[spenderField] must be in this list (lowercased)
}

export interface Policy {
  maxValueWei?: string; // reject a tx sending more native value than this
  allowTo?: string[]; // if set, tx `to` must be in this list (lowercased)
  allowChains?: number[]; // if set, chainId must be in this list
  allowTypedData?: TypedDataRule[]; // if set, /v1/sign/typed-data must match one rule
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
