import { describe, expect, it } from "vitest";
import { codeHash, seal, unseal } from "../src/worker/session";

const SECRET = "test-secret-0123456789";

describe("session cookie", () => {
  it("round-trips a session", async () => {
    const s = { userId: "u1", strava: { cislo: "0288", jmeno: "a", heslo: "b" } };
    expect(await unseal(await seal(s, SECRET, "session-cookie"), SECRET, "session-cookie")).toEqual(s);
  });
  it("can't be opened with another secret or purpose, or when tampered with", async () => {
    const t = await seal({ userId: "u1" }, SECRET, "session-cookie");
    expect(await unseal(t, "other-secret", "session-cookie")).toBeNull();
    expect(await unseal(t, SECRET, "login-code")).toBeNull();
    expect(await unseal(t.slice(0, -2) + (t.endsWith("A") ? "BB" : "AA"), SECRET, "session-cookie")).toBeNull();
    expect(await unseal("garbage!", SECRET, "session-cookie")).toBeNull();
  });
});

describe("login code hash", () => {
  it("depends on the e-mail, the code and the secret", async () => {
    const h = await codeHash(SECRET, "a@b.cz", "123456");
    expect(await codeHash(SECRET, "a@b.cz", "123456")).toBe(h);
    expect(await codeHash(SECRET, "a@b.cz", "123457")).not.toBe(h);
    expect(await codeHash(SECRET, "c@b.cz", "123456")).not.toBe(h);
    expect(await codeHash("x", "a@b.cz", "123456")).not.toBe(h);
  });
});
