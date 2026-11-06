// Web Push with VAPID (RFC 8292). With a payload it's encrypted for the subscriber (RFC 8291, aes128gcm), so the
// push services of Google/Apple/Mozilla can't read it; without one the service worker shows a fixed text.

export interface VapidKeys {
  publicKey: string; // base64url, uncompressed P-256 point
  privateJwk: string;
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function vapidJwt(audience: string, privateJwk: string): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", JSON.parse(privateJwk), { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: "https://github.com/oondraa/OpenStudent",
  })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

// The browsers' push services (Chrome & co., Firefox, Safari, Edge). Any other URL would make the Worker POST to
// wherever a subscriber points it.
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

export function isPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 1024) return false;
  try {
    const { protocol, hostname } = new URL(endpoint);
    return protocol === "https:" && PUSH_HOSTS.some((h) => (h.startsWith(".") ? hostname.endsWith(h) : hostname === h));
  } catch {
    return false;
  }
}

export interface PushTarget {
  endpoint: string;
  p256dh?: string | null;
  auth?: string | null;
}

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) out.set(p, (i += p.length) - p.length);
  return out;
};
const te = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, bytes * 8));
}

/** RFC 8291 message encryption (one aes128gcm record). */
export async function encryptPayload(payload: string, p256dh: string, auth: string) {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  const as = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", as.publicKey)) as ArrayBuffer);
  const ua = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ua }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(te.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, concat(te.encode(payload), new Uint8Array([2])) as BufferSource));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

/** Returns false when the subscription is gone and should be deleted. */
export async function sendPush(target: string | PushTarget, keys: VapidKeys, payload?: object): Promise<boolean> {
  const t = typeof target === "string" ? { endpoint: target } : target;
  const jwt = await vapidJwt(new URL(t.endpoint).origin, keys.privateJwk);
  const headers: Record<string, string> = { authorization: `vapid t=${jwt}, k=${keys.publicKey}`, ttl: String(12 * 3600), urgency: "normal" };
  let body: Uint8Array | undefined;
  if (payload && t.p256dh && t.auth) {
    body = await encryptPayload(JSON.stringify(payload), t.p256dh, t.auth);
    headers["content-encoding"] = "aes128gcm";
    headers["content-type"] = "application/octet-stream";
  }
  const res = await fetch(t.endpoint, { method: "POST", headers, body: body as BodyInit | undefined });
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) console.warn(`push ${res.status} for ${new URL(t.endpoint).host}`);
  return true;
}
