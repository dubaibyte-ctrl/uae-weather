// Pure request-validation for the temporary /api/ig-test endpoint. No I/O, no token handling — unit-tested.
import { IG_TARGET } from "./connectors.js";

export const MAX_BODY = 4096;   // the body is just {token, username}; anything larger is rejected

// Returns null when the request is acceptable, or { status, body } describing the rejection. Pure: it is given plain
// values (never the token) so it can be tested in isolation. The token itself is validated/used only by igDiscover.
export function igTestGuard({ method, contentType, origin, expectedOrigin, contentLength, username }) {
  if (method !== "POST") return { status: 405, body: { ok: false, error: "Method not allowed; use POST." } };
  if (!/application\/json/i.test(contentType || "")) return { status: 415, body: { ok: false, error: "Content-Type must be application/json." } };
  if (!origin || origin !== expectedOrigin) return { status: 403, body: { ok: false, error: "Cross-origin requests are not allowed." } };
  if (contentLength != null && Number(contentLength) > MAX_BODY) return { status: 413, body: { ok: false, error: "Request body too large." } };
  if (username != null && username !== IG_TARGET) return { status: 400, body: { ok: false, error: "Target is locked to the configured account; other usernames are not allowed." } };
  return null;
}
