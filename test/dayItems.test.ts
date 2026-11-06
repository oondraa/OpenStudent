import { describe, expect, it } from "vitest";
import { dayItems, periodOf } from "../src/web/Timetable";

const lesson = (subject: string, start: string, end: string, cancelled = false) =>
  ({ subject, start, end, room: "211", group: "", teacher: "HU", changed: false, cancelled, added: false, meet: null });
const day = (lessons: ReturnType<typeof lesson>[], lunch: { start: string; end: string } | null) =>
  ({ date: "2026-10-14", label: "14. středa", lessons, lunch }) as Parameters<typeof dayItems>[0];
const shape = (d: Parameters<typeof dayItems>[0]) => dayItems(d).map((i) => `${i.kind} ${i.start}-${i.end}`);

describe("dayItems", () => {
  it("splits a long break into lunch and free time", () => {
    expect(shape(day([lesson("MAT", "10:45", "11:30"), lesson("AGJ", "13:45", "14:30")], { start: "11:30", end: "13:30" }))).toEqual([
      "lesson 10:45-11:30",
      "lunch 11:30-12:00",
      "free 12:00-13:45",
      "lesson 13:45-14:30",
    ]);
  });

  it("shows free time before lunch when the canteen opens later", () => {
    expect(shape(day([lesson("MAT", "9:45", "10:30"), lesson("AGJ", "12:45", "13:30")], { start: "11:30", end: "12:40" }))).toEqual([
      "lesson 9:45-10:30",
      "free 10:30-11:30",
      "lunch 11:30-12:00",
      "free 12:00-12:45",
      "lesson 12:45-13:30",
    ]);
  });

  it("leaves ordinary breaks alone and keeps lunch after the last lesson", () => {
    expect(shape(day([lesson("MAT", "8:00", "8:45"), lesson("AGJ", "8:55", "9:40")], { start: "11:30", end: "13:30" }))).toEqual([
      "lesson 8:00-8:45",
      "lesson 8:55-9:40",
      "lunch 11:30-12:00",
    ]);
  });

  it("folds a cancelled lesson into the one taught in its slot, keeps it alone when nothing is", () => {
    const d = day([lesson("MAT", "8:45", "9:30", true), lesson("CJL", "9:45", "10:30"), lesson("FYZ", "8:45", "9:30", true), lesson("AGJ", "8:45", "9:30"), lesson("DEJ", "10:45", "11:30", true)], null);
    const items = dayItems(d);
    expect(items.map((i) => (i.kind === "lesson" ? `${i.lesson.subject}${i.lesson.cancelled ? " x" : ""}` : i.kind))).toEqual(["AGJ", "CJL", "DEJ x"]);
    expect(items[0].kind === "lesson" && items[0].was?.map((l) => l.subject)).toEqual(["MAT", "FYZ"]);
  });

  it("folds a cancelled lesson into one shifted by a few minutes", () => {
    const d = day([lesson("P20", "12:45", "13:30"), lesson("OBN", "12:55", "13:40", true), lesson("P20", "13:45", "14:30"), lesson("CJL", "13:45", "14:30", true)], null);
    const items = dayItems(d);
    expect(items.map((i) => (i.kind === "lesson" ? `${i.lesson.subject} ${i.was?.map((l) => l.subject) ?? ""}` : i.kind))).toEqual(["P20 OBN", "P20 CJL"]);
  });

  it("matches a room change to the lesson of the same subject", () => {
    const d = day([lesson("CJL", "8:45", "9:30"), { ...lesson("MAT", "8:45", "9:30"), group: "2" }, lesson("MAT", "8:45", "9:30", true)], null);
    const [a, b] = dayItems(d);
    expect([a.kind === "lesson" && a.was, b.kind === "lesson" && b.was?.length]).toEqual([undefined, 1]);
  });
});

describe("periodOf", () => {
  it("numbers lessons on, across and slightly off the bell schedule", () => {
    expect([["9:45", "10:30"], ["13:45", "15:30"], ["12:55", "13:40"], ["11:35", "12:20"], ["6:00", "6:40"]].map(([start, end]) => periodOf({ start, end }))).toEqual([
      "3", "7–8", "6", "5", "",
    ]);
  });
});
