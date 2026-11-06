import { describe, expect, it } from "vitest";
import { isTick } from "../src/worker/school";

// Prague is UTC+1 on these dates (winter time).
const at = (utc: string) => Date.parse(`2026-11-02T${utc}:00Z`);

describe("isTick", () => {
  it("wakes the check every 10 minutes during the day", () => {
    expect(isTick(at("09:00"))).toBe(true);
    expect(isTick(at("09:10"))).toBe(true);
    expect(isTick(at("09:05"))).toBe(false);
    expect(isTick(at("09:15"))).toBe(false);
  });

  it("follows Prague time, from 6:00 to 22:30", () => {
    expect(isTick(at("04:50"))).toBe(false); // 5:50
    expect(isTick(at("05:00"))).toBe(true); // 6:00
    expect(isTick(at("21:30"))).toBe(true); // 22:30
    expect(isTick(at("21:40"))).toBe(false); // 22:40
    expect(isTick(at("23:00"))).toBe(false); // 0:00
  });

  it("knows summer time", () => {
    expect(isTick(Date.parse("2026-06-01T04:00:00Z"))).toBe(true); // 6:00 CEST
    expect(isTick(Date.parse("2026-06-01T03:50:00Z"))).toBe(false); // 5:50 CEST
  });
});
