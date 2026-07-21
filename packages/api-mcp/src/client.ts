import { readFileSync } from "node:fs";
import type { ToolDef } from "./spec.js";

export interface ClientConfig {
  apiKey?: string; // exchange partner key -> x-api-key
  jwt?: string; // client-api auth -> Authorization: Bearer
  jwtFile?: string; // path to a file holding the JWT; re-read per request (token refresh)
}

// Resolve the bearer JWT at call time: prefer the file (so a cron re-mint is picked up
// without restarting the MCP), else the static env value.
function resolveJwt(cfg: ClientConfig): string | undefined {
  if (cfg.jwtFile) {
    try {
      const t = readFileSync(cfg.jwtFile, "utf8").trim();
      if (t) return t;
    } catch {
      // fall through to the static value
    }
  }
  return cfg.jwt;
}

export interface CallResult {
  status: number;
  ok: boolean;
  data: unknown;
}

// A 429 whose countdown is within this many seconds is waited out and retried once,
// transparently, so short API cooldowns (comment 6s, etc.) succeed instead of
// surfacing as an error the agent might drop. Longer cooldowns, or 429s with no
// countdown, surface to the caller to decide. Applies to every endpoint uniformly.
const MAX_AUTO_RETRY_WAIT_SECONDS = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Seconds to wait from a 429, read from the body `retryAfter` (seconds) or the
// `Retry-After` header. null when neither is present (then we do not retry). Only
// consulted on a 429, so the tip-cap 402's epoch-timestamp retryAfter is never read.
function retryAfterSeconds(res: Response, data: unknown): number | null {
  if (data && typeof data === "object" && "retryAfter" in data) {
    const v = (data as { retryAfter?: unknown }).retryAfter;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  const h = res.headers.get("retry-after");
  if (h !== null) {
    const n = Number(h);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export async function callEndpoint(
  cfg: ClientConfig,
  tool: ToolDef,
  args: Record<string, any>
): Promise<CallResult> {
  let path = tool.path;
  for (const p of tool.pathParams) {
    if (args[p] === undefined || args[p] === null) {
      throw new Error(`Missing required path parameter: ${p}`);
    }
    path = path.replace(`{${p}}`, encodeURIComponent(String(args[p])));
  }

  const url = new URL(tool.baseUrl.replace(/\/+$/, "") + path);
  for (const q of tool.queryParams) {
    const v = args[q];
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(q, String(v));
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  const jwt = resolveJwt(cfg);
  if (jwt) headers["authorization"] = `Bearer ${jwt}`;

  let body: string | FormData | undefined;
  if (tool.bodyProps.length > 0) {
    const b: Record<string, any> = {};
    for (const k of tool.bodyProps) if (args[k] !== undefined) b[k] = args[k];
    if (tool.bodyContentType === "multipart/form-data") {
      const fd = new FormData();
      for (const [k, v] of Object.entries(b)) fd.append(k, String(v));
      body = fd;
    } else if (tool.bodyContentType === "application/x-www-form-urlencoded") {
      body = new URLSearchParams(b as Record<string, string>).toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    } else {
      body = JSON.stringify(b);
      headers["content-type"] = "application/json";
    }
  }

  const doFetch = async (): Promise<{ res: Response; data: unknown }> => {
    const res = await fetch(url, { method: tool.method, headers, body });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { res, data };
  };

  let { res, data } = await doFetch();
  if (res.status === 429) {
    const wait = retryAfterSeconds(res, data);
    if (wait !== null && wait <= MAX_AUTO_RETRY_WAIT_SECONDS) {
      await sleep(wait * 1000);
      ({ res, data } = await doFetch());
    }
  }
  return { status: res.status, ok: res.ok, data };
}
