// Phase B hardening: Business Discovery test endpoint security. Pure functions, no network, no Durable Object.
import test from "node:test";
import assert from "node:assert/strict";
import { igDiscover, IG_TARGET, instagramStormCentre, PULL_CONNECTORS } from "../src/lib/connectors.js";
import { igTestGuard, MAX_BODY } from "../src/lib/ig-test.js";

const okFetch = (TOKEN) => async (url, opts) => {
  calls.push({ url, opts });
  if (url.includes("me/accounts")) return { json: async () => ({ data: [{ instagram_business_account: { id: "17841000", username: "me" } }] }) };
  if (url.includes("business_discovery")) return { json: async () => ({ business_discovery: { username: IG_TARGET, media: { data: [
    { id: "m1", caption: "أمطار على المسافي", timestamp: "2026-11-12T06:00:00+0000", permalink: "https://www.instagram.com/p/AAA/", media_type: "IMAGE" },
  ] } } }) };
  return { json: async () => ({ error: { code: 1, message: "unexpected" } }) };
};
let calls = [];

test("igDiscover sends the token ONLY in the Authorization header — never in any requested URL", async () => {
  calls = [];
  const TOKEN = "SECRET_TOKEN_abc123";
  const r = await igDiscover({ token: TOKEN, fetchImpl: okFetch(TOKEN) });
  assert.equal(r.ok, true);
  assert.ok(calls.length >= 2, "both Graph calls were made");
  for (const c of calls) {
    assert.ok(!c.url.includes(TOKEN), "token must never appear in the URL");
    assert.ok(!/access_token/i.test(c.url), "no access_token query param");
    assert.equal(c.opts.headers.Authorization, "Bearer " + TOKEN, "token is in the Authorization header");
  }
  // sanitized media carries the required fields and no token
  const m = r.media[0];
  assert.deepEqual(Object.keys(m).sort(), ["captionChars", "captionPreview", "id", "media_type", "permalink", "timestamp"]);
  assert.equal(m.permalink, "https://www.instagram.com/p/AAA/");
  assert.ok(!JSON.stringify(r).includes(TOKEN), "token must never appear in the response");
});

test("igDiscover refuses any target other than the locked account", async () => {
  const r = await igDiscover({ token: "t", fetchImpl: async () => ({ json: async () => ({}) }), username: "someone_else" });
  assert.equal(r.ok, false);
  assert.match(r.error, /locked/i);
});

test("igDiscover scrubs the token out of Meta error messages", async () => {
  const TOKEN = "TyTOKEN_xyz_789";
  const f = async (url) => {
    if (url.includes("me/accounts")) return { json: async () => ({ data: [{ instagram_business_account: { id: "1", username: "me" } }] }) };
    return { json: async () => ({ error: { code: 190, message: "Invalid OAuth token " + TOKEN + " has expired" } }) };
  };
  const r = await igDiscover({ token: TOKEN, fetchImpl: f });
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(TOKEN), "token must be scrubbed from the error");
});

test("igTestGuard rejects GET, non-JSON, cross-origin, oversized bodies, and non-locked targets", () => {
  const base = { method: "POST", contentType: "application/json", origin: "https://uae-weather.dubaibyte.workers.dev", expectedOrigin: "https://uae-weather.dubaibyte.workers.dev", contentLength: 120, username: null };
  assert.equal(igTestGuard({ ...base, method: "GET" }).status, 405);
  assert.equal(igTestGuard({ ...base, contentType: "text/plain" }).status, 415);
  assert.equal(igTestGuard({ ...base, origin: "https://evil.example" }).status, 403);
  assert.equal(igTestGuard({ ...base, origin: null }).status, 403);
  assert.equal(igTestGuard({ ...base, contentLength: MAX_BODY + 1 }).status, 413);
  assert.equal(igTestGuard({ ...base, username: "another_account" }).status, 400);
  assert.equal(igTestGuard({ ...base, username: IG_TARGET }), null, "the locked target is allowed");
  assert.equal(igTestGuard(base), null, "a well-formed request passes");
});

test("the production Instagram connector stays disabled and targets the verified account", async () => {
  assert.equal(await instagramStormCentre.ready({ env: {} }), false);        // no token -> inert
  assert.equal(await instagramStormCentre.ready({ env: { IG_ACCESS_TOKEN: "tok" } }), true);
  assert.equal(instagramStormCentre.id, "instagram:storm.center");
  assert.ok(PULL_CONNECTORS.some((c) => c.id === "instagram:storm.center" && c.requiresToken));
});
