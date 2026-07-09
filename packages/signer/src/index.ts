#!/usr/bin/env node
// Per-agent signing service. Holds keys server-side (token -> key) and signs
// token-authenticated requests, so agent processes never hold raw keys.
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 8787);
const app = createApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.error(`kumbaya-onchain-signer listening on :${info.port}`);
});
