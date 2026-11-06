import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import { readSchoolDay } from "../src/shared/schoolOcr";

// Real images from https://sis.ssakhk.cz/TimeTable/School are not committed (they name teachers).
// Download them into test/fixtures/ to run this: curl -o test/fixtures/PO1.jpg https://sis.ssakhk.cz/TimeTable/PO1.jpg
const fixture = "test/fixtures/PO1-2026-10-12.jpg";

describe.skipIf(!existsSync(fixture))("readSchoolDay (Monday 12.10.2026)", () => {
  const cells = existsSync(fixture) ? readSchoolDay(jpeg.decode(readFileSync(fixture))) : [];
  const at = (cls: string, period: number, slot = 0) => cells.find((c) => c.cls === cls && c.period === period && c.slot === slot);

  it("reads gym lessons", () => {
    expect(at("G1", 1)).toMatchObject({ subject: "TEV", teacher: "MH", room: "T0", changed: false });
    expect(at("T1", 3)).toMatchObject({ subject: "TEV", teacher: "MH", room: "P0" });
    expect(at("G4", 5)).toMatchObject({ subject: "TEV", teacher: "RO", room: "P0" });
  });

  it("reads group lessons and changes", () => {
    expect(at("T1", 5, 1)).toMatchObject({ subject: "AGJ2", teacher: "KT", room: "403" });
    expect(at("T2", 4)).toMatchObject({ subject: "ELZ", teacher: "HU", room: "B13", changed: true });
    expect(at("G1", 3)).toMatchObject({ subject: "CJL", room: "206", changed: true });
  });

  it("only sees gym lessons in T0 and P0", () => {
    const gym = cells.filter((c) => c.room === "T0" || c.room === "P0");
    expect(gym.length).toBeGreaterThan(5);
    expect(gym.every((c) => c.subject.startsWith("TEV"))).toBe(true);
  });
});

// Rooms the free-room finder subtracts: a misread room would show a taken classroom as free.
const tuesday = "test/fixtures/UT1-2026-10-13.jpg";
const wednesday = "test/fixtures/ST1-2026-10-14.jpg";

describe.skipIf(!existsSync(tuesday) || !existsSync(wednesday))("readSchoolDay rooms (13. and 14.10.2026)", () => {
  const read = (f: string) => (existsSync(f) ? readSchoolDay(jpeg.decode(readFileSync(f))) : []);
  const tue = read(tuesday);
  const wed = read(wednesday);
  const at = (cells: typeof tue, cls: string, period: number) => cells.find((c) => c.cls === cls && c.period === period && c.slot === 0);

  it("reads the 3 drawn one pixel wider", () => {
    expect(at(tue, "G1", 4)?.room).toBe("317");
    expect(at(tue, "G2", 9)?.room).toBe("403");
    expect(at(wed, "I4", 8)?.room).toBe("302");
    expect(at(wed, "G3", 3)?.room).toBe("B13");
  });

  it("doesn't split 211 at the narrow 1", () => {
    expect(at(tue, "G3", 4)?.room).toBe("211");
    expect(at(wed, "T4", 4)?.room).toBe("211");
  });

  it("only reads room numbers of the usual shape", () => {
    const rooms = new Set([...tue, ...wed].map((c) => c.room).filter(Boolean));
    expect([...rooms].filter((r) => !/^(\d{3}|B1\d|[PT]0)$/.test(r))).toEqual([]);
  });
});
