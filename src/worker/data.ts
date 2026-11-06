// Data the pipeline (pipeline/, a GitHub Action every night) uploads: the school catalog, every school's public
// timetable for this and next week, and the canteen forecast. Stored as JSON in D1 (`datasets`), read through the
// edge cache so a busy morning costs a handful of D1 reads.

import { periodOf } from "../shared/periods";
import type { Cell, Day, Lesson, SchoolInfo } from "../shared/types";

/** One lesson as the pipeline stores it (pipeline/openstudent/sources.py). */
export interface RawLesson {
  s: number;
  e: number;
  subj: string;
  name: string;
  room: string;
  group: string;
  teacher: string;
  change: "" | "sub" | "add" | "room" | "cancel";
}
export interface RawDay {
  date: string | null;
  off: boolean;
  lessons: RawLesson[];
}
export interface SchoolTimetable {
  school: string;
  fetched: string;
  periods: [string, string][];
  /** Monday (YYYY-MM-DD) → class → Monday…Friday */
  weeks: Record<string, Record<string, RawDay[]>>;
}

export const DATASETS = /^(schools|menza|ends|tt-[a-z0-9-]{1,40})$/;
const TTL = 300;

/** The Workers edge cache (null outside a Worker, e.g. in tests). */
export const edgeCache = (): Cache | null =>
  typeof caches !== "undefined" ? ((caches as unknown as { default?: Cache }).default ?? null) : null;

/** A dataset by name, null when the pipeline hasn't uploaded it yet. */
export async function dataset<T>(db: D1Database, name: string): Promise<T | null> {
  const key = new Request(`https://data.openstudent.internal/${name}`);
  const cache = edgeCache();
  const hit = await cache?.match(key);
  if (hit) return (await hit.json()) as T;
  const row = await db.prepare("SELECT body FROM datasets WHERE name = ?").bind(name).first<{ body: string }>();
  if (!row) return null;
  await cache?.put(key, new Response(row.body, { headers: { "content-type": "application/json", "cache-control": `max-age=${TTL}` } }));
  return JSON.parse(row.body) as T;
}

export async function putDataset(db: D1Database, name: string, body: string) {
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await db
    .prepare("INSERT INTO datasets (name, body, hash, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(name) DO UPDATE SET body = ?2, hash = ?3, updated = ?4")
    .bind(name, body, hash, Date.now())
    .run();
  await edgeCache()?.delete(new Request(`https://data.openstudent.internal/${name}`));
  return hash;
}

export const schools = (db: D1Database) => dataset<SchoolInfo[]>(db, "schools");
export const timetableOf = (db: D1Database, school: string) => dataset<SchoolTimetable>(db, `tt-${school}`);

const fmt = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
const DAYS = ["pondělí", "úterý", "středa", "čtvrtek", "pátek"];

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lessons the student's groups don't attend are left out (no groups chosen = everything). */
export function inGroups(group: string, groups: string[]) {
  if (!group || !groups.length) return true;
  return group.split(/,\s*/).some((g) => groups.includes(g));
}

function toLesson(l: RawLesson, date: string): Lesson {
  return {
    id: `${date}|${l.s}|${l.subj}|${l.group}`,
    subject: l.subj || "hodina",
    subjectName: l.name || undefined,
    start: fmt(l.s),
    end: fmt(l.e),
    room: l.room,
    group: l.group,
    teacher: l.teacher,
    changed: l.change === "sub" || l.change === "room",
    cancelled: l.change === "cancel",
    added: l.change === "add",
    meet: null,
  };
}

/** A break of ≥ 25 min between 11:00 and 14:30, else right after the last lesson if that's before 14:00. */
function lunchOf(lessons: RawLesson[]): Day["lunch"] {
  const on = lessons.filter((l) => l.change !== "cancel").sort((a, b) => a.s - b.s);
  if (!on.length) return null;
  let end = on[0].e;
  for (const l of on.slice(1)) {
    if (l.s - end >= 25 && end < 14 * 60 + 30 && l.s > 11 * 60) return { start: fmt(Math.max(end, 11 * 60 + 15)), end: fmt(l.s) };
    end = Math.max(end, l.e);
  }
  return end <= 14 * 60 ? { start: fmt(Math.max(end, 11 * 60 + 15)), end: fmt(Math.min(end + 45, 14 * 60 + 30)) } : null;
}

/** The class's week as the app's Day[] (Monday `week`). Empty when the pipeline has no such week. */
export function classWeek(tt: SchoolTimetable, cls: string, week: string, groups: string[] = []): Day[] {
  const days = tt.weeks[week]?.[cls];
  if (!days) return [];
  return days.slice(0, 5).map((d, i) => {
    const date = d.date ?? addDays(week, i);
    const lessons = d.off ? [] : d.lessons.filter((l) => inGroups(l.group, groups));
    const dm = new Date(`${date}T00:00:00Z`).getUTCDate();
    return { date, label: `${dm}. ${DAYS[i]}`, lessons: lessons.map((l) => toLesson(l, date)), lunch: d.off ? null : lunchOf(lessons) };
  });
}

/** The whole school on one day, as cells (period index from the school's bell schedule). */
export function schoolDay(tt: SchoolTimetable, date: string, week: string): Cell[] {
  const wd = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const out: Cell[] = [];
  for (const [cls, days] of Object.entries(tt.weeks[week] ?? {})) {
    const d = days[wd];
    if (!d || d.off) continue;
    const slots = new Map<number, number>();
    for (const l of d.lessons) {
      if (l.change === "cancel") continue;
      const period = periodOf(fmt(l.s), tt.periods);
      const slot = slots.get(period) ?? 0;
      slots.set(period, slot + 1);
      out.push({ cls, period, slot, subject: l.subj, teacher: l.teacher, room: l.room, changed: l.change !== "" });
    }
  }
  return out;
}

/** Every group name used in a class (for the "moje skupiny" choice). */
export function classGroups(tt: SchoolTimetable, cls: string): string[] {
  const set = new Set<string>();
  for (const wk of Object.values(tt.weeks)) for (const d of wk[cls] ?? []) for (const l of d.lessons) for (const g of l.group.split(/,\s*/)) if (g) set.add(g);
  return [...set].sort((a, b) => a.localeCompare(b, "cs", { numeric: true }));
}
