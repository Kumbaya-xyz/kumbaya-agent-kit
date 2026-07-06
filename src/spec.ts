// Builds MCP tools directly from the bundled Kumbaya Exchange OpenAPI spec.
// The spec is the source of truth — tools always match the API, no hand-copied
// endpoint definitions to drift. Refresh with `npm run refresh-spec`.
import rawSpec from "./openapi.json";

const spec = rawSpec as any;

export interface ToolDef {
  name: string;
  description: string;
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  bodyProps: string[];
  inputSchema: Record<string, any>;
}

function resolveRef(ref: string): any {
  const parts = ref.replace(/^#\//, "").split("/");
  let cur: any = spec;
  for (const p of parts) cur = cur?.[p];
  return cur;
}

function deref(schema: any, depth = 0): any {
  if (!schema || depth > 8) return schema;
  if (schema.$ref) return deref(resolveRef(schema.$ref), depth + 1);
  return schema;
}

function cleanName(method: string, path: string): string {
  const segs = path.replace(/^\/api(\/v1)?/, "").split("/").filter(Boolean);
  const parts = segs.map((s) =>
    s.startsWith("{")
      ? "by_" + s.slice(1, -1).replace(/([A-Z])/g, "_$1").toLowerCase()
      : s.replace(/-/g, "_")
  );
  return [method, ...parts].join("_").replace(/_+/g, "_");
}

export function buildTools(): ToolDef[] {
  const tools: ToolDef[] = [];
  const used = new Set<string>();

  for (const [path, methods] of Object.entries<any>(spec.paths)) {
    for (const [method, op] of Object.entries<any>(methods)) {
      if (method.startsWith("x-") || typeof op !== "object") continue;

      let base = (op.operationId || cleanName(method, path)).replace(/[^a-zA-Z0-9_]/g, "_");
      let name = base;
      for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
      used.add(name);

      const properties: Record<string, any> = {};
      const required: string[] = [];
      const pathParams: string[] = [];
      const queryParams: string[] = [];
      const bodyProps: string[] = [];

      for (const p of op.parameters || []) {
        const s = deref(p.schema) || { type: "string" };
        properties[p.name] = { ...s, description: p.description || s.description || undefined };
        if (p.required) required.push(p.name);
        if (p.in === "path") pathParams.push(p.name);
        else if (p.in === "query") queryParams.push(p.name);
      }

      const bodySchema = deref(op.requestBody?.content?.["application/json"]?.schema);
      if (bodySchema?.properties) {
        for (const [k, v] of Object.entries<any>(bodySchema.properties)) {
          properties[k] = deref(v);
          bodyProps.push(k);
        }
        for (const r of bodySchema.required || []) if (!required.includes(r)) required.push(r);
      }

      // Quote endpoints are partner-gated (partnerApiKeyGuard). "open" means no
      // token allowlist, NOT no auth — every /quote* route needs an API key.
      const isPartner = path.startsWith("/api/v1/quote");
      const partnerNote = isPartner
        ? " [PARTNER ONLY: requires an API key (set KUMBAYA_API_KEY / sent as x-api-key). Request access from the Kumbaya team.]"
        : "";

      const description =
        ([op.summary, op.description].filter(Boolean).join(". ") ||
          `${method.toUpperCase()} ${path}`) + partnerNote;

      tools.push({
        name,
        description,
        method: method.toUpperCase(),
        path,
        pathParams,
        queryParams,
        bodyProps,
        inputSchema: { type: "object", properties, required },
      });
    }
  }
  return tools;
}

export const SPEC_INFO = {
  title: spec.info?.title,
  version: spec.info?.version,
  server: spec.servers?.[0]?.url,
};
