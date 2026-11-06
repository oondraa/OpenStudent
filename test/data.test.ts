import { describe, expect, it } from "vitest";
import { classGroups, classWeek, inGroups, schoolDay, type SchoolTimetable } from "../src/worker/data";
import { describe as describeChanges } from "../src/worker/notify";

const L = (s: number, e: number, subj: string, extra: Partial<{ room: string; group: string; teacher: string; change: string }> = {}) =>
  ({ s, e, subj, name: subj, room: "", group: "", teacher: "", change: "", ...extra }) as SchoolTimetable["weeks"][string][string][number]["lessons"][number];

const tt: SchoolTimetable = {
  school: "x",
  fetched: "2026-11-06T02:00:00",
  periods: [["8:00", "8:45"], ["8:55", "9:40"], ["10:00", "10:45"], ["10:55", "11:40"], ["11:50", "12:35"], ["12:45", "13:30"]],
  weeks: {
    "2026-11-09": {
      "2.A": [
        { date: "2026-11-09", off: false, lessons: [L(480, 525, "ČJ", { room: "12", teacher: "No" }), L(535, 580, "Aj", { group: "2A1", room: "J1" }), L(535, 580, "Nj", { group: "2A2", room: "J2" }), L(765, 810, "M", { change: "sub" })] },
        { date: "2026-11-10", off: false, lessons: [L(480, 525, "F", { change: "cancel" }), L(535, 580, "Ch")] },
        { date: "2026-11-11", off: true, lessons: [] },
        { date: "2026-11-12", off: false, lessons: [] },
        { date: "2026-11-13", off: false, lessons: [L(480, 525, "Tv", { change: "add" })] },
      ],
      "2.B": [{ date: "2026-11-09", off: false, lessons: [L(480, 525, "M", { room: "13" })] }],
    },
  },
};

describe("classWeek", () => {
  it("maps the pipeline's lessons to the app's days", () => {
    const days = classWeek(tt, "2.A", "2026-11-09");
    expect(days).toHaveLength(5);
    expect(days[0].label).toBe("9. pondělí");
    expect(days[0].lessons[0]).toMatchObject({ subject: "ČJ", start: "8:00", end: "8:45", room: "12", teacher: "No", changed: false });
    expect(days[0].lessons.at(-1)).toMatchObject({ subject: "M", changed: true });
    expect(days[1].lessons[0]).toMatchObject({ subject: "F", cancelled: true });
    expect(days[2].lessons).toEqual([]);
    expect(days[4].lessons[0].added).toBe(true);
    // a long noon break is the lunch slot
    expect(days[0].lunch).toEqual({ start: "11:15", end: "12:45" });
  });
  it("keeps only the student's groups when they chose some", () => {
    expect(classWeek(tt, "2.A", "2026-11-09", ["2A1"])[0].lessons.map((l) => l.subject)).toEqual(["ČJ", "Aj", "M"]);
    expect(inGroups("2A1, 2A2", ["2A2"])).toBe(true);
    expect(inGroups("", ["2A2"])).toBe(true);
  });
  it("is empty for an unknown week or class", () => {
    expect(classWeek(tt, "2.A", "2026-11-16")).toEqual([]);
    expect(classWeek(tt, "9.Z", "2026-11-09")).toEqual([]);
  });
  it("lists the class's groups", () => {
    expect(classGroups(tt, "2.A")).toEqual(["2A1", "2A2"]);
  });
});

describe("schoolDay", () => {
  it("puts every lesson of the school into its period, cancelled ones left out", () => {
    const mon = schoolDay(tt, "2026-11-09", "2026-11-09");
    expect(mon.filter((c) => c.cls === "2.A").map((c) => [c.period, c.slot, c.subject])).toEqual([
      [0, 0, "ČJ"],
      [1, 0, "Aj"],
      [1, 1, "Nj"],
      [5, 0, "M"],
    ]);
    expect(mon.find((c) => c.cls === "2.B")).toMatchObject({ period: 0, room: "13" });
    expect(schoolDay(tt, "2026-11-10", "2026-11-09").map((c) => c.subject)).toEqual(["Ch"]);
  });
});

describe("change notification text", () => {
  it("says what changed, day by day", () => {
    expect(
      describeChanges([
        { date: "2026-11-10", start: 480, group: "", now: "ČJ · 105 · No" },
        { date: "2026-11-10", start: 535, group: "", now: null },
        { date: "2026-11-12", start: 600, group: "", now: "M · 12 · Ab" },
      ]),
    ).toBe("Út 10. 11.: 8:00 ČJ · 105 · No, 8:55 odpadá\nČt 12. 11.: 10:00 M · 12 · Ab");
  });
});
