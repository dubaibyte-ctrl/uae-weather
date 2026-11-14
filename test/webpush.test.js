// Web Push crypto, pinned to the RFC 8291 Appendix A test vector. Pure Web Crypto; no network.
import test from "node:test";
import assert from "node:assert/strict";
import { encryptPayload, b64urlToBytes, bytesToB64url, generateVapidKeys, vapidJwt, buildPushRequest, importP256Public } from "../src/lib/webpush.js";

// RFC 8291 Appendix A, verbatim (https://datatracker.ietf.org/doc/html/rfc8291#appendix-A).
const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

async function keyPairFromVector(pubB64, privB64) {
  const pub = b64urlToBytes(pubB64);
  const jwk = { kty: "EC", crv: "P-256", d: privB64, x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), ext: true };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = await importP256Public(pub, { name: "ECDH", namedCurve: "P-256" }, [], true);
  return { privateKey, publicKey };
}

test("encryptPayload reproduces the RFC 8291 Appendix A header and ciphertext byte-for-byte", async () => {
  const body = await encryptPayload(new TextEncoder().encode(V.plaintext), V.uaPublic, V.auth, await keyPairFromVector(V.asPublic, V.asPrivate), b64urlToBytes(V.salt));
  assert.equal(body.length, 86 + b64urlToBytes(V.ciphertext).length);
  assert.equal(bytesToB64url(body.slice(0, 86)), V.header, "aes128gcm header: salt || rs=4096 || idlen=65 || as_public");
  assert.equal(bytesToB64url(body.slice(86)), V.ciphertext, "ciphertext + GCM tag");
});

test("VAPID keys + JWT: ES256 signature verifies with the published public key; aud/sub/exp correct", async () => {
  const k = await generateVapidKeys();
  assert.equal(b64urlToBytes(k.publicKey).length, 65);
  const jwt = await vapidJwt("https://fcm.googleapis.com", "mailto:test@example.com", k.privateJwk);
  const [h, p, s] = jwt.split(".");
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  assert.equal(payload.aud, "https://fcm.googleapis.com");
  assert.equal(payload.sub, "mailto:test@example.com");
  assert.ok(payload.exp > Date.now() / 1000 && payload.exp <= Date.now() / 1000 + 24 * 3600, "exp within 24h (RFC 8292)");
  const pub = await crypto.subtle.importKey("raw", b64urlToBytes(k.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlToBytes(s), new TextEncoder().encode(h + "." + p)));
});

test("buildPushRequest: aes128gcm headers, vapid auth with k=, body decryptable shape, no secret in URL/headers", async () => {
  const k = await generateVapidKeys();
  // a real-looking subscription created from a fresh UA keypair
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", p256dh: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey))), auth: bytesToB64url(crypto.getRandomValues(new Uint8Array(16))) };
  const req = await buildPushRequest(sub, { title: "t", body: "b" }, { ...k, subject: "mailto:x@y.z" });
  assert.equal(req.url, sub.endpoint);
  assert.equal(req.headers["Content-Encoding"], "aes128gcm");
  assert.match(req.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.ok(req.headers.Authorization.includes("k=" + k.publicKey));
  const all = JSON.stringify(req.headers) + req.url;
  assert.ok(!all.includes(k.privateJwk.d), "private VAPID key never appears in URL or headers");
  assert.equal(req.body[16 + 4], 65, "keyid length = 65 (uncompressed P-256)");
});

test("interop: a payload built by buildPushRequest decrypts with the reference http_ece library (as a browser would)", async () => {
  const { createRequire } = await import("node:module");
  const ece = createRequire(import.meta.url)("http_ece");
  const nodeCrypto = await import("node:crypto");
  const ua = nodeCrypto.createECDH("prime256v1"); ua.generateKeys();
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: bytesToB64url(ua.getPublicKey()), auth: bytesToB64url(nodeCrypto.randomBytes(16)) };
  const k = await generateVapidKeys();
  const payload = { title: "أمطار قرب مليحة", body: "Storm Centre UAE · 10:42", url: "/?area=mleiha" };
  const req = await buildPushRequest(sub, payload, { ...k, subject: "mailto:x@y.z" });
  const plain = ece.decrypt(Buffer.from(req.body), { version: "aes128gcm", privateKey: ua, authSecret: Buffer.from(b64urlToBytes(sub.auth)) });
  assert.deepEqual(JSON.parse(plain.toString("utf8")), payload, "Arabic UTF-8 payload survives encryption intact");
});
