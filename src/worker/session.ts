import type { StravaCred } from "./strava";

// The session lives only inside this encrypted cookie on the student's device. Unlike OpenSISAKHK there's no school
// password in it: the student signed in with an e-mail code, the cookie just says who they are.
export interface Session {
  userId: string;
  /** Canteen login (Strava.cz), only once connected in Settings. Lives only in this cookie, never on the server. */
  strava?: StravaCred;
}

/** What a sealed value is for. Each purpose gets its own key. */
export type Purpose = "session-cookie" | "login-code";

const enc = new TextEncoder();
const dec = new TextDecoder();
const V1 = 1;
const keys = new Map<string, Promise<CryptoKey>>();

function purposeKey(secret: string, purpose: Purpose) {
  const id = `${purpose}\0${secret}`;
  let k = keys.get(id);
  if (!k) {
    k = crypto.subtle
      .importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"])
      .then((ikm) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: enc.encode("OpenStudent"), info: enc.encode(purpose) },
          ikm,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    keys.set(id, k);
  }
  return k;
}

const b64url = (buf: Uint8Array) => btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function seal<T = Session>(value: T, secret: string, purpose: Purpose): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await purposeKey(secret, purpose), enc.encode(JSON.stringify(value)));
  const out = new Uint8Array(1 + iv.length + data.byteLength);
  out[0] = V1;
  out.set(iv, 1);
  out.set(new Uint8Array(data), 1 + iv.length);
  return b64url(out);
}

/** Opens a sealed value, or null when it's broken, tampered with or sealed for another purpose. */
export async function unseal<T = Session>(token: string, secret: string, purpose: Purpose): Promise<T | null> {
  try {
    const buf = fromB64url(token);
    if (buf[0] !== V1) return null;
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(1, 13) }, await purposeKey(secret, purpose), buf.slice(13));
    return JSON.parse(dec.decode(data)) as T;
  } catch {
    return null;
  }
}

/** HMAC of a login code (keyed by the server secret and the e-mail), so the stored value is useless on its own. */
export async function codeHash(secret: string, email: string, code: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`login-code\0${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${email}\0${code}`));
  return b64url(new Uint8Array(sig));
}
