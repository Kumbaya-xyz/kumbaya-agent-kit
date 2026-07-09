// Builds MCP tools from Kumbaya's OpenAPI specs (exchange DEX, client app +
// launchpad, search). Spec-driven: tools always match the API. Refresh with
// `npm run refresh-spec`.
import exchangeSpec from "./specs/exchange.json";
import clientSpec from "./specs/client.json";
import searchSpec from "./specs/search.json";

export type Auth = "public" | "partner" | "bearer";

export interface ServiceMeta {
  name: string;
  prefix: string;
  spec: any;
  // Default base URL. NOTE: the client-api spec advertises localhost as its
  // server, so we do not trust spec.servers for it — these are the real ones.
  defaultBaseUrl: string;
  authOf: (path: string, method: string, op: any) => Auth;
  exclude: (path: string, method: string) => boolean;
}

const excludeClient = (p: string) => /\/(admin|webhooks?|analytics|monitoring)(\/|$)/.test(p);

// The client-api OpenAPI spec under-declares `security`, so op.security alone is
// not reliable. Authenticated client-api routes are: anything declaring security,
// every write method (except the public-write allowlist), and a few authed GETs.
const CLIENT_PUBLIC_WRITES = new Set([
  "/v1/session/create",
  "/v1/session/wallet-state",
  "/v1/session/wallet/verify",
  "/v1/session/logout",
  "/v1/tokens/batch/images",
]);
const CLIENT_AUTH_GETS = new Set(["/v1/gifts/status", "/v1/gifts/prepare", "/v1/launch/pending"]);

function clientAuth(path: string, method: string, op: any): Auth {
  if (op?.security) return "bearer";
  if (CLIENT_AUTH_GETS.has(path)) return "bearer";
  if (path.startsWith("/v1/launch")) return "bearer"; // launches are user-scoped
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
  if (isWrite && !CLIENT_PUBLIC_WRITES.has(path)) return "bearer";
  return "public";
}

export const SERVICES: ServiceMeta[] = [
  {
    name: "exchange",
    prefix: "dex",
    spec: exchangeSpec,
    defaultBaseUrl: "https://exchange.kumbaya.xyz",
    authOf: (p) => (p.startsWith("/api/v1/quote") ? "partner" : "public"),
    exclude: () => false,
  },
  {
    name: "client",
    prefix: "app",
    spec: clientSpec,
    defaultBaseUrl: "https://clients.kumbaya.xyz",
    authOf: (p, m, op) => clientAuth(p, m, op),
    exclude: (p) => excludeClient(p),
  },
  {
    name: "search",
    prefix: "search",
    spec: searchSpec,
    defaultBaseUrl: "https://search.kumbaya.xyz",
    authOf: () => "public",
    exclude: () => false,
  },
];

export interface ToolDef {
  name: string;
  description: string;
  service: string;
  baseUrl: string;
  method: string;
  path: string;
  auth: Auth;
  pathParams: string[];
  queryParams: string[];
  bodyProps: string[];
  bodyContentType: string | null; // application/json | multipart/form-data | application/x-www-form-urlencoded
  inputSchema: Record<string, any>;
}

function deref(spec: any, schema: any, depth = 0): any {
  if (!schema || depth > 8) return schema;
  if (schema.$ref) {
    const parts = schema.$ref.replace(/^#\//, "").split("/");
    let cur: any = spec;
    for (const p of parts) cur = cur?.[p];
    return deref(spec, cur, depth + 1);
  }
  return schema;
}

function cleanName(method: string, path: string): string {
  const segs = path.replace(/^\/(api\/v1|api|v1)/, "").split("/").filter(Boolean);
  const parts = segs.map((s) =>
    s.startsWith("{")
      ? "by_" + s.slice(1, -1).replace(/([A-Z])/g, "_$1").toLowerCase()
      : s.replace(/[-.]/g, "_")
  );
  return [method, ...parts].join("_").replace(/_+/g, "_").toLowerCase();
}

const AUTH_NOTE: Record<Auth, string> = {
  public: "",
  partner:
    " [PARTNER ONLY: requires an API key (set KUMBAYA_API_KEY, sent as x-api-key). Request access from the Kumbaya team.]",
  bearer: " [Requires authentication: set KUMBAYA_JWT (sent as Authorization: Bearer).]",
};

export interface BuildOptions {
  services?: string[]; // enabled service names; default all
  baseUrls?: Record<string, string>; // per-service base URL override
}

export function buildTools(opts: BuildOptions = {}): ToolDef[] {
  const enabled = opts.services;
  const tools: ToolDef[] = [];
  const used = new Set<string>();

  for (const svc of SERVICES) {
    if (enabled && !enabled.includes(svc.name)) continue;
    const spec = svc.spec;
    const baseUrl = opts.baseUrls?.[svc.name] || svc.defaultBaseUrl;

    for (const [path, methods] of Object.entries<any>(spec.paths || {})) {
      for (const [method, op] of Object.entries<any>(methods)) {
        if (method.startsWith("x-") || typeof op !== "object") continue;
        if (svc.exclude(path, method)) continue;

        const base = `${svc.prefix}_${op.operationId || cleanName(method, path)}`.replace(
          /[^a-zA-Z0-9_]/g,
          "_"
        );
        let name = base;
        for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
        used.add(name);

        const properties: Record<string, any> = {};
        const required: string[] = [];
        const pathParams: string[] = [];
        const queryParams: string[] = [];
        const bodyProps: string[] = [];

        for (const p of op.parameters || []) {
          const s = deref(spec, p.schema) || { type: "string" };
          properties[p.name] = { ...s, description: p.description || s.description || undefined };
          if (p.required) required.push(p.name);
          if (p.in === "path") pathParams.push(p.name);
          else if (p.in === "query") queryParams.push(p.name);
        }

        const content = op.requestBody?.content || {};
        let bodyContentType: string | null = null;
        for (const ct of ["application/json", "multipart/form-data", "application/x-www-form-urlencoded"]) {
          if (content[ct]) { bodyContentType = ct; break; }
        }
        if (!bodyContentType && Object.keys(content).length) bodyContentType = Object.keys(content)[0];

        const bodySchema = bodyContentType ? deref(spec, content[bodyContentType]?.schema) : undefined;
        if (bodySchema?.properties) {
          for (const [k, v] of Object.entries<any>(bodySchema.properties)) {
            const ps = deref(spec, v);
            properties[k] = ps?.format === "binary"
              ? { type: "string", description: `${ps.description || k} (file path or URL; optional)` }
              : ps;
            bodyProps.push(k);
          }
          for (const r of bodySchema.required || []) if (!required.includes(r)) required.push(r);
        }

        const auth = svc.authOf(path, method, op);
        const description =
          ([op.summary, op.description].filter(Boolean).join(". ") ||
            `${method.toUpperCase()} ${path}`) + AUTH_NOTE[auth];

        tools.push({
          name,
          description,
          service: svc.name,
          baseUrl,
          method: method.toUpperCase(),
          path,
          auth,
          pathParams,
          queryParams,
          bodyProps,
          bodyContentType,
          inputSchema: { type: "object", properties, required },
        });
      }
    }
  }
  return tools;
}

export const SERVICE_NAMES = SERVICES.map((s) => s.name);
