import { z } from "zod";

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: (args: any) => Promise<unknown>;
}

/** Wrap a result as an MCP text content block (JSON-encoded). */
export function ok(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) },
    ],
  };
}
