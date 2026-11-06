import { describe, expect, it } from "vitest";
import { absenceMessage, compare, compareTimetable, gradesMessage, timetableMessage } from "../src/shared/watch";
import type { Absence, Subject } from "../src/worker/parse";

const grade = (value: string, name: string, date = "1.10.2026") =>
  ({ date, value, numeric: null, type: "P", typeName: "", weight: 3, name, comment: "" }) as Subject["grades"][number];
const subjects = (grades: Subject["grades"]): Subject[] => [{ name: "MAT", average: null, grades }];
const absence = (missed: Absence["missed"]): Absence => ({ subjects: [], total: null, missed });

describe("compare", () => {
  it("only remembers on the first check", async () => {
    const r = await compare(null, subjects([grade("1", "Písemka")]), absence([]));
    expect(r.grades).toEqual([]);
    expect(r.next.g).toHaveLength(1);
    expect(r.next.g[0]).toMatch(/^[0-9a-f]{12}$/);
  });

  it("finds new grades and absences since the last check", async () => {
    const first = await compare(null, subjects([grade("1", "Písemka")]), absence([]));
    const l = { date: "2026-10-12", period: 3, subject: "MAT", teacher: "NO", code: "n" };
    const r = await compare(first.next, subjects([grade("1", "Písemka"), grade("2-", "Test", "5.10.2026")]), absence([l]));
    expect(r.grades).toEqual([{ subject: "MAT", value: "2-", name: "Test", weight: 3 }]);
    expect(r.missed).toEqual([l]);
  });
});

describe("messages", () => {
  it("formats grades and absences", () => {
    expect(gradesMessage([{ subject: "MAT", value: "1", name: "Písemka", weight: 3 }])).toMatchObject({
      title: "Nová známka",
      body: "MAT: 1 · Písemka (váha 3)",
    });
    const m = absenceMessage([
      { date: "2026-10-12", period: 4, subject: "FYZ", teacher: "", code: "" },
      { date: "2026-10-12", period: 3, subject: "MAT", teacher: "", code: "" },
    ]);
    expect(m).toMatchObject({ title: "Nová absence (2 h)", body: "Po 12. 10.: 3. MAT, 4. FYZ" });
  });
});

describe("compareTimetable", () => {
  const lesson = (start: string, subject: string, room: string) =>
    ({ id: null, subject, start, end: "", room, group: "", teacher: "NO", changed: false, cancelled: false, added: false, meet: null }) as const;
  const day = (date: string, lessons: ReturnType<typeof lesson>[]) => ({ date, label: "", lessons: [...lessons], lunch: null });

  it("reports changed, added and cancelled lessons of days seen before", async () => {
    const first = await compareTimetable(undefined, [day("2026-10-13", [lesson("8:00", "MAT", "211"), lesson("8:55", "FYZ", "B13")])], "2026-10-12");
    expect(first.changes).toEqual([]);
    const r = await compareTimetable(
      first.next,
      [
        day("2026-10-13", [lesson("8:00", "MAT", "105"), lesson("10:00", "AGJ", "B13")]),
        day("2026-10-14", [lesson("8:00", "ELZ", "211")]), // new day: nothing to compare yet
      ],
      "2026-10-12",
    );
    expect(r.changes.map((c) => [c.start, c.lesson?.room ?? null])).toEqual([
      ["8:00", "105"],
      ["10:00", "B13"],
      ["8:55", null],
    ]);
    expect(timetableMessage(r.changes, "2026-10-12").body).toBe("Út 13. 10.: 8:00 MAT · 105 · NO, 8:55 odpadá, 10:00 AGJ · B13 · NO");
  });

  it("treats a lesson SIS strikes out as cancelled", async () => {
    const first = await compareTimetable(undefined, [day("2026-10-13", [lesson("8:00", "MAT", "211")])], "2026-10-12");
    const struck = { ...lesson("8:00", "MAT", "211"), cancelled: true };
    const r = await compareTimetable(first.next, [{ date: "2026-10-13", label: "", lessons: [struck], lunch: null }], "2026-10-12");
    expect(r.changes.map((c) => [c.start, c.lesson])).toEqual([["8:00", null]]);
  });
});
