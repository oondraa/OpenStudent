import { describe, expect, it } from "vitest";
import { seal, unseal } from "../src/worker/session";

const SECRET = "test-secret-that-is-long-enough";
const cred = { u: "jan.novak", p: "heslo" };

/** A value sealed the way it was before 1.15.3: AES-GCM with SHA-256(secret), no format byte. */
async function legacySeal(value: unknown) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value))));
  return btoa(String.fromCharCode(...iv, ...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("seal / unseal", () => {
  it("opens what it sealed, with a fresh IV every time", async () => {
    const a = await seal(cred, SECRET, "watcher-cred");
    const b = await seal(cred, SECRET, "watcher-cred");
    expect(a).not.toBe(b);
    expect(await unseal(a, SECRET, "watcher-cred")).toEqual({ value: cred, legacy: false });
  });

  it("keeps the purposes apart", async () => {
    const stored = await seal(cred, SECRET, "watcher-cred");
    expect(await unseal(stored, SECRET, "session-cookie")).toBeNull();
    // A stored SIS session can't be passed off as a stored login, nor the other way round.
    expect(await unseal(stored, SECRET, "watcher-session")).toBeNull();
    expect(await unseal(await seal({ a: "b" }, SECRET, "watcher-session"), SECRET, "watcher-cred")).toBeNull();
  });

  it("rejects another secret, tampering and garbage", async () => {
    const t = await seal(cred, SECRET, "session-cookie");
    expect(await unseal(t, "other-secret", "session-cookie")).toBeNull();
    const i = 20;
    const flipped = t.slice(0, i) + (t[i] === "A" ? "B" : "A") + t.slice(i + 1);
    expect(await unseal(flipped, SECRET, "session-cookie")).toBeNull();
    expect(await unseal("not base64!", SECRET, "session-cookie")).toBeNull();
  });

  it("still opens values sealed with the old shared key and flags them", async () => {
    // 50 random IVs: some start with the format byte by chance and must still fall back.
    for (let i = 0; i < 50; i++) {
      expect(await unseal(await legacySeal(cred), SECRET, "watcher-cred")).toEqual({ value: cred, legacy: true });
    }
  });
});
