// Web Push (RFC 8030/8291/8188 + VAPID RFC 8292) using Web Crypto only — no Node APIs, no external service.
// Keys are generated and used here; the private VAPID key lives only in the Durable Object (never in the repo or a log).
// Pure/testable: the encryption core is validated by interop with the reference web-push library in test/webpush.test.js.

const enc = new TextEncoder();
export function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
}
export function bytesToB64url(u) {
  u = u instanceof Uint8Array ? u : new Uint8Array(u); let bin = ""; for (const b of u) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...arrs) { const n = arrs.reduce((a, x) => a + x.length, 0), out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }
// Import an uncompressed P-256 public point (0x04||x||y, 65 bytes) via JWK — works in both workerd and Node, unlike
// importKey("raw", ...) for EC public keys which Node's WebCrypto rejects.
export function importP256Public(bytes, algo, usages = [], extractable = false) {
  const x = bytesToB64url(bytes.slice(1, 33)), y = bytesToB64url(bytes.slice(33, 65));
  return crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x, y, ext: true }, algo, extractable, usages);
}

async function hmac(keyBytes, data) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
// HKDF to length<=32 (single expand block), the only case Web Push needs.
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

// ---- VAPID keys ----
// Generate a P-256 keypair; return the public key as a raw uncompressed point (b64url, for the client applicationServerKey
// and the "k" header) and the private key as JWK (stored in the DO). Generated with ECDSA so it can sign the VAPID JWT.
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: bytesToB64url(rawPub), privateJwk: jwk };
}

// Signed VAPID JWT (ES256). audience = scheme+host of the push endpoint; subject = mailto:... (or a URL).
export async function vapidJwt(audience, subject, privateJwk, ttlSec = 12 * 3600) {
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64url(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + ttlSec, sub: subject })));
  const signingInput = header + "." + body;
  const key = await crypto.subtle.importKey("jwk", { ...privateJwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput))); // raw r||s (64B)
  return signingInput + "." + bytesToB64url(sig);
}

// ---- aes128gcm content encryption (RFC 8291 + RFC 8188) ----
// Encrypt `payloadBytes` for a subscription's {p256dh (ua public, 65B b64url), auth (16B b64url)}. `asKeyPair` is an ECDH
// P-256 keypair (ephemeral); `salt` is 16 random bytes. Returns the aes128gcm body (header || ciphertext). Exposed with
// explicit keys/salt so the RFC test vector can pin it; sendWebPush() generates the keypair and salt itself.
export async function encryptPayload(payloadBytes, p256dhB64, authB64, asKeyPair, salt) {
  const uaPublic = b64urlToBytes(p256dhB64), authSecret = b64urlToBytes(authB64);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));
  const uaKey = await importP256Public(uaPublic, { name: "ECDH", namedCurve: "P-256" }, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeyPair.privateKey, 256));
  // RFC 8291 §3.4: IKM = HKDF(auth, ecdh, "WebPush: info"||0x00||ua_public||as_public, 32)
  const keyInfo = concat(enc.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  // RFC 8188 aes128gcm: CEK and NONCE from the record salt
  const cek = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  const plaintext = concat(payloadBytes, new Uint8Array([2])); // single record: 0x02 delimiter, no extra padding
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext));
  const rs = new Uint8Array([0, 0, 0x10, 0x00]); // record size 4096
  const header = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic);
  return concat(header, cipher);
}

// Build the full POST (url + headers + body) for a subscription + JSON payload. Does not fetch — caller sends it, so the
// network call is easy to mock in tests. vapid = { publicKey, privateJwk, subject }.
export async function buildPushRequest(subscription, payloadObj, vapid, ttl = 1800, urgency = "normal") {
  const url = new URL(subscription.endpoint);
  const audience = url.origin;
  const jwt = await vapidJwt(audience, vapid.subject, vapid.privateJwk);
  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload(enc.encode(JSON.stringify(payloadObj)), subscription.p256dh, subscription.auth, asKeyPair, salt);
  return {
    url: subscription.endpoint,
    headers: {
      "Authorization": `vapid t=${jwt}, k=${vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": String(ttl),
      "Urgency": urgency,   // "high" -> FCM high priority: delivered promptly even when an Android device is dozing
    },
    body,
  };
}

// Send one push. Returns { ok, status, gone } — gone=true means the subscription is expired (404/410) and should be pruned.
export async function sendWebPush(subscription, payloadObj, vapid, fetchImpl = fetch, ttl = 1800, urgency = "normal") {
  const req = await buildPushRequest(subscription, payloadObj, vapid, ttl, urgency);
  const r = await fetchImpl(req.url, { method: "POST", headers: req.headers, body: req.body });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, gone: r.status === 404 || r.status === 410 };
}
