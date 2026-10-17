// Test-only: lets Node import src/log.js by stubbing the "cloudflare:workers" module.
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(s, c, n) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
  return n(s, c);
}`));
