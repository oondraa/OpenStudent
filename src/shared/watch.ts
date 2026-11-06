import type { Absence, Day, Lesson, MissedLesson, Subject } from "../worker/parse";

/** What the server remembers between checks: short hashes only, so the database never holds grades. */
export interface Seen {
  g: string[];
  a: string[];
  /** Personal timetable: date → lesson start → hash of the lesson. Missing in rows saved before it existed. */
  t?: Record<string, Record<string, string>>;
}

export interface TimetableChange {
  date: string;
  start: string;
  /** The lesson now in that slot, or null when it was cancelled. */
  lesson: Lesson | null;
}

/**
 * Compares the personal timetable (this and next week, from `today` on) with the last check. Only days
 * that were already seen are compared: a week that just came into view has nothing to differ from.
 */
export async function compareTimetable(seen: Seen["t"], days: Day[], today: string) {
  const next: NonNullable<Seen["t"]> = {};
  const changes: TimetableChange[] = [];
  for (const d of days) {
    if (d.date < today) continue;
    const slots: Record<string, string> = {};
    // The "changed" flag is left out: SIS drops it again the next day without anything changing.
    // A cancelled lesson stays in SIS struck out: its slot is reported as cancelled, as if it were gone.
    const lessons = d.lessons.filter((l) => !l.cancelled);
    for (const l of lessons) slots[l.start] = await hash([l.subject, l.room, l.teacher, l.group].join("|"));
    next[d.date] = slots;
    const before = seen?.[d.date];
    if (!before) continue;
    for (const l of lessons) if (before[l.start] !== slots[l.start]) changes.push({ date: d.date, start: l.start, lesson: l });
    for (const start of Object.keys(before)) if (!(start in slots)) changes.push({ date: d.date, start, lesson: null });
  }
  return { next, changes };
}

export interface NewGrade {
  subject: string;
  value: string;
  name: string;
  weight: number | null;
}

async function hash(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf, 0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const gradeKey = (subject: string, g: Subject["grades"][number]) => [subject, g.date, g.value, g.type, g.name].join("|");
const absenceKey = (l: MissedLesson) => [l.date, l.period, l.subject].join("|");

/**
 * Compares a fresh reading with what was seen last time. The first check (`seen` = null) only
 * remembers, so switching it on doesn't flood the student with every grade of the semester.
 */
export async function compare(seen: Seen | null, subjects: Subject[], absence: Absence) {
  const grades = await Promise.all(
    subjects.flatMap((s) => s.grades.map(async (g) => ({ h: await hash(gradeKey(s.name, g)), g: { subject: s.name, value: g.value, name: g.name, weight: g.weight } }))),
  );
  const missed = await Promise.all(absence.missed.map(async (l) => ({ h: await hash(absenceKey(l)), l })));
  const next: Seen = { g: grades.map((x) => x.h), a: missed.map((x) => x.h) };
  if (!seen) return { next, grades: [] as NewGrade[], missed: [] as MissedLesson[] };
  const g = new Set(seen.g);
  const a = new Set(seen.a);
  return {
    next,
    grades: grades.filter((x) => !g.has(x.h)).map((x) => x.g),
    missed: missed.filter((x) => !a.has(x.h)).map((x) => x.l),
  };
}

const DAYS = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}. ${m}.`;
};

export function gradesMessage(grades: NewGrade[]) {
  const line = (g: NewGrade) => `${g.subject}: ${g.value}${g.name ? ` · ${g.name}` : ""}${g.weight ? ` (váha ${g.weight})` : ""}`;
  return {
    title: grades.length === 1 ? "Nová známka" : `Nové známky (${grades.length})`,
    body: grades.slice(0, 6).map(line).join("\n") + (grades.length > 6 ? `\na další ${grades.length - 6}` : ""),
    tag: "grades",
    url: "/?tab=grades",
  };
}

export function absenceMessage(missed: MissedLesson[]) {
  const byDate = new Map<string, MissedLesson[]>();
  for (const l of missed) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  const lines = [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ls]) => `${day(date)}: ${ls.sort((a, b) => a.period - b.period).map((l) => `${l.period}. ${l.subject}`).join(", ")}`);
  return {
    title: missed.length === 1 ? "Nová absence" : `Nová absence (${missed.length} h)`,
    body: lines.join("\n"),
    tag: "absence",
    url: "/?tab=absence",
  };
}

export function timetableMessage(changes: TimetableChange[], today: string) {
  const byDate = new Map<string, TimetableChange[]>();
  for (const c of changes) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c]);
  const toMin = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
  const item = (c: TimetableChange) =>
    c.lesson ? `${c.start} ${[c.lesson.subject, c.lesson.room, c.lesson.teacher].filter(Boolean).join(" · ")}` : `${c.start} odpadá`;
  const lines = [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cs]) => `${date === today ? "Dnes" : day(date)}: ${cs.sort((a, b) => toMin(a.start) - toMin(b.start)).map(item).join(", ")}`);
  return { title: "Změna rozvrhu", body: lines.join("\n"), tag: "timetable", url: "/?tab=timetable" };
}
