import type { Jar } from "./sis";
import type { StravaCred } from "./strava";

// The session lives only inside this encrypted cookie on the student's device; the server stores none of it
// (except the sealed login and SIS session of students who opt in to grade/absence notifications, see migrations/0003
// and 0005).
// The credentials are kept so an expired SIS session can be renewed silently instead of logging the user out.
export interface Session {
  jar: Jar;
  userId: string;
  cred: { u: string; p: string };
  /** Canteen login (Strava.cz), only once connected in Settings. Same rules: lives only in this cookie. */
  strava?: StravaCred;
}

/** What a sealed value is for. Each purpose gets its own key, so a value sealed for one can't be opened as another. */
export type Purpose = "session-cookie" | "watcher-cred" | "watcher-session";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Format byte in front of values sealed with a per-purpose HKDF key. Older values (no byte) used SHA-256(secret). */
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
          { name: "HKDF", hash: "SHA-256", salt: enc.encode("OpenSISAKHK"), info: enc.encode(purpose) },
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

/** The single key everything was sealed with before 1.15.3. Only read, so old cookies and stored logins still open. */
async function legacyKey(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

async function open(buf: Uint8Array, key: CryptoKey) {
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
  return JSON.parse(dec.decode(data));
}

const b64url = (buf: Uint8Array) =>
  btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function seal<T = Session>(value: T, secret: string, purpose: Purpose): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await purposeKey(secret, purpose), enc.encode(JSON.stringify(value)));
  const out = new Uint8Array(1 + iv.length + data.byteLength);
  out[0] = V1;
  out.set(iv, 1);
  out.set(new Uint8Array(data), 1 + iv.length);
  return b64url(out);
}

/**
 * Opens a sealed value, or null when it's broken, tampered with or sealed for another purpose. `legacy` means it
 * was sealed with the old shared key, so the caller should seal it again.
 */
export async function unseal<T = Session>(token: string, secret: string, purpose: Purpose): Promise<{ value: T; legacy: boolean } | null> {
  let buf: Uint8Array;
  try {
    buf = fromB64url(token);
  } catch {
    return null;
  }
  // AES-GCM authenticates, so a wrong guess about the format just fails. An old value can start with V1 by chance.
  if (buf[0] === V1) {
    try {
      return { value: await open(buf.slice(1), await purposeKey(secret, purpose)), legacy: false };
    } catch {
      /* not v1 after all */
    }
  }
  try {
    return { value: await open(buf, await legacyKey(secret)), legacy: true };
  } catch {
    return null;
  }
}
