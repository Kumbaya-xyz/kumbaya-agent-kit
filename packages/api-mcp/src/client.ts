import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import type { ToolDef } from "./spec.js";

const FILE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};
const mimeFor = (name: string): string =>
  FILE_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

// Resolve a multipart binary field (format:binary) whose value is a local file
// path or an http(s) URL into an uploadable Blob. Returns null if it is neither
// (then the caller sends it as a plain string field, preserving prior behavior).
async function loadFilePart(v: string): Promise<{ blob: Blob; filename: string } | null> {
  if (/^https?:\/\//i.test(v)) {
    try {
      const res = await fetch(v);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const filename = basename(new URL(v).pathname) || "upload";
      return { blob: new Blob([buf], { type: res.headers.get("content-type") || mimeFor(filename) }), filename };
    } catch {
      return null;
    }
  }
  if (existsSync(v)) {
    const filename = basename(v);
    return { blob: new Blob([readFileSync(v)], { type: mimeFor(filename) }), filename };
  }
  return null;
}

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

// A video comment returns 202 { status: "processing", nonce } and finishes in the
// background (uploads to X, then creates the comment; if X fails the comment is never
// created). We mirror the website (kumbaya-frontend pollSubmission.ts): poll the
// submission endpoint until done/failed, so the tool returns the real outcome instead
// of a bare "processing" the caller would misread as success. Bounded so it can't hang.
const SUBMISSION_POLL_MAX_MS = Number(process.env.KUMBAYA_SUBMISSION_POLL_MAX_MS) || 120_000;
const SUBMISSION_POLL_INTERVAL_MS = Number(process.env.KUMBAYA_SUBMISSION_POLL_INTERVAL_MS) || 8_000;

function processingNonce(data: unknown): string | null {
  if (data && typeof data === "object" && "status" in data && "nonce" in data) {
    const { status, nonce } = data as { status?: unknown; nonce?: unknown };
    if (status === "processing" && typeof nonce === "string" && nonce) return nonce;
  }
  return null;
}

async function pollSubmission(
  baseUrl: string,
  nonce: string,
  headers: Record<string, string>
): Promise<CallResult> {
  const url = baseUrl.replace(/\/+$/, "") + `/v1/comments/submission/${encodeURIComponent(nonce)}`;
  const deadline = Date.now() + SUBMISSION_POLL_MAX_MS;
  while (Date.now() < deadline) {
    await sleep(SUBMISSION_POLL_INTERVAL_MS);
    let status: number;
    let body: unknown;
    try {
      const res = await fetch(url, { method: "GET", headers });
      status = res.status;
      const text = await res.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } catch {
      continue; // transient network error; keep polling until the deadline
    }
    if (status === 404 || status >= 500) continue; // not recorded yet / transient; keep polling
    const s = body && typeof body === "object" ? (body as { status?: unknown }).status : undefined;
    if (s === "done") {
      const comment = (body as { comment?: unknown }).comment;
      return { status: 201, ok: true, data: comment ?? body };
    }
    if (s === "failed") {
      return { status: 502, ok: false, data: body };
    }
    // "processing" -> keep polling
  }
  return {
    status: 202,
    ok: false,
    data: {
      status: "timeout",
      nonce,
      error: `video comment still processing after ${Math.round(SUBMISSION_POLL_MAX_MS / 1000)}s; not confirmed`,
    },
  };
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

  let body: BodyInit | undefined;
  if (tool.bodyProps.length > 0) {
    const b: Record<string, any> = {};
    for (const k of tool.bodyProps) if (args[k] !== undefined) b[k] = args[k];
    if (tool.bodyContentType === "application/octet-stream") {
      const v = b["file"];
      if (typeof v === "string" && v) {
        const part = await loadFilePart(v);
        if (part) {
          body = part.blob;
          headers["content-type"] = part.blob.type || "application/octet-stream";
        } else {
          throw new Error(`file not found or unreadable: ${v}`);
        }
      }
    } else if (tool.bodyContentType === "multipart/form-data") {
      const fileProps = new Set(tool.bodyFileProps ?? []);
      const fd = new FormData();
      for (const [k, v] of Object.entries(b)) {
        if (fileProps.has(k) && typeof v === "string" && v) {
          const part = await loadFilePart(v);
          if (part) { fd.append(k, part.blob, part.filename); continue; }
        }
        fd.append(k, String(v));
      }
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
  if (res.status === 202) {
    const nonce = processingNonce(data);
    if (nonce) return pollSubmission(tool.baseUrl, nonce, headers);
  }
  return { status: res.status, ok: res.ok, data };
}
