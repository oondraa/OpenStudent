import { describe, expect, it } from "vitest";
import type { Cell } from "../src/shared/schoolOcr";
import { teachersAt } from "../src/web/whoTeaches";

const cell = (cls: string, period: number, subject: string, teacher: string, room: string, changed = false): Cell =>
  ({ cls, period, slot: 0, subject, teacher, room, changed });

describe("teachersAt", () => {
  const day = [
    cell("G1", 1, "TEV", "MH", "T0"),
    cell("T1", 1, "TEV", "MH", "T0"),
    cell("T2", 1, "ELZ", "HU", "B13", true),
    cell("T3", 3, "ELZ", "HU", "309"),
    cell("I2", 2, "MAT", "TI", "B15"),
    cell("G3", 0, "AGJ", "SA", "205"),
    cell("T4", 1, "B06", "", ""),
  ];

  it("merges one teacher's classes and lists the rest by their next lesson", () => {
    const { teaching, free } = teachersAt(day, 1);
    expect(teaching).toEqual([
      { teacher: "HU", subject: "ELZ", classes: ["T2"], rooms: ["B13"], changed: true },
      { teacher: "MH", subject: "TEV", classes: ["G1", "T1"], rooms: ["T0"], changed: false },
    ]);
    expect(free).toEqual([
      { teacher: "TI", next: 2 },
      { teacher: "SA", next: null },
    ]);
  });
});
