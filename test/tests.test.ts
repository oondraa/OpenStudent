import { describe, expect, it } from "vitest";
import { TEST_NOTE_MAX, cleanNote, sameLesson } from "../src/shared/tests";

describe("cleanNote", () => {
  it("keeps one plain line", () => {
    expect(cleanNote("  kapitola\n3–4\t ")).toBe("kapitola 3–4");
    expect(cleanNote("a‮b​c")).toBe("a b c");
  });

  it("caps the length and drops what isn't text", () => {
    expect(cleanNote("x".repeat(500))).toHaveLength(TEST_NOTE_MAX);
    expect(cleanNote(42)).toBe("");
    expect(cleanNote(undefined)).toBe("");
  });
});

describe("sameLesson", () => {
  const t = { date: "2026-11-03", start: "8:45", subject: "M", group: "1" };
  it("matches the slot, the subject and the group", () => {
    expect(sameLesson(t, "2026-11-03", { start: "8:45", subject: "M", group: "1" })).toBe(true);
    expect(sameLesson(t, "2026-11-03", { start: "8:45", subject: "M", group: "2" })).toBe(false);
    expect(sameLesson(t, "2026-11-04", { start: "8:45", subject: "M", group: "1" })).toBe(false);
    expect(sameLesson(t, "2026-11-03", { start: "9:45", subject: "M", group: "1" })).toBe(false);
  });
});
