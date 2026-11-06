import { describe, expect, it } from "vitest";
import { blockers, budgets, plan, remainingLessons, semesterEnd, verdict } from "../src/web/absencePlan";
import type { Day, Lesson } from "../src/worker/parse";

const lesson = (subject: string) => ({ subject }) as Lesson;
const week = (monday: string, perDay: string[][]): Day[] =>
  perDay.map((subjects, i) => ({
    date: new Date(Date.parse(monday) + i * 864e5).toISOString().slice(0, 10),
    label: "",
    lessons: subjects.map(lesson),
    lunch: null,
  }));

describe("plan", () => {
  it("counts lessons to attend to get under 30 %", () => {
    // 4 of 10 = 40 %; 4/14 = 28.6 % is the first share under 30 %.
    expect(plan({ missed: 4, taught: 10 }, null).needed).toBe(4);
    // exactly 30 % is not under the line
    expect(plan({ missed: 3, taught: 10 }, null).needed).toBe(1);
    expect(plan({ missed: 2, taught: 10 }, null).needed).toBe(0);
  });

  it("computes the reserve until the end of the semester", () => {
    // 20 lessons in total, under 30 % means at most 5 missed: 3 more.
    expect(plan({ missed: 2, taught: 10 }, 10)).toEqual({ needed: 0, remaining: 10, reserve: 3, best: 10 });
    // even attending everything leaves 10/12 > 30 %
    expect(plan({ missed: 10, taught: 10 }, 2)).toMatchObject({ needed: 24, reserve: 0, best: 83.3 });
  });
});

describe("remainingLessons", () => {
  const a = week("2026-10-12", [["MAT", "MAT"], ["FYZ"], [], [], ["TEV"]]);
  const b = week("2026-10-19", [["MAT"], [], [], [], []]);

  it("alternates the two weeks and skips holidays and weekends", () => {
    // from Tue 20. 10. to Fri 30. 10.: week B (Tue–Fri) then week A Mon 26. + Tue 27., 28.–30. are holidays
    const r = remainingLessons("2026-10-12", a, b, "2026-10-19", "2026-10-30");
    expect(Object.fromEntries(r)).toEqual({ MAT: 2, FYZ: 1 });
  });

  it("knows the semester ends", () => {
    expect(semesterEnd("2026-10-12")).toBe("2027-01-28");
    expect(semesterEnd("2027-03-01")).toBe("2027-06-30");
  });
});

describe("skip calculator", () => {
  const reserves = new Map<string, number | null>([["MAT", 3], ["FYZ", 1], ["CJL", 0], ["NEW", null]]);

  it("takes planned skips off the reserve", () => {
    const b = budgets(reserves, ["MAT", "MAT", "FYZ"]);
    expect(b.get("MAT")).toBe(1);
    expect(b.get("FYZ")).toBe(0);
    expect(b.get("NEW")).toBeNull();
  });

  it("tells which lessons can still go", () => {
    expect(verdict(3)).toBe("ok");
    expect(verdict(1)).toBe("last");
    expect(verdict(0)).toBe("no");
    expect(verdict(-1)).toBe("no");
    expect(verdict(null)).toBe("unknown");
  });

  it("finds what stops skipping a whole day", () => {
    expect(blockers(reserves, ["MAT", "MAT", "FYZ"])).toEqual([]);
    expect(blockers(reserves, ["FYZ", "FYZ", "CJL"])).toEqual(["FYZ", "CJL"]);
    // unknown subjects (no reserve) block too: the app can't promise anything about them
    expect(blockers(reserves, ["NEW", "XYZ"])).toEqual(["NEW", "XYZ"]);
  });
});
