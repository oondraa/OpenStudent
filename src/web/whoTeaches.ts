import type { Cell } from "../shared/schoolOcr";

export interface Teaching {
  teacher: string;
  subject: string;
  /** One lesson can be shared by several classes (or groups of them). */
  classes: string[];
  rooms: string[];
  changed: boolean;
}

export interface NotTeaching {
  teacher: string;
  /** Their next period that day, null = done for the day. */
  next: number | null;
}

const byName = (a: { teacher: string }, b: { teacher: string }) => a.teacher.localeCompare(b.teacher, "cs");
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/**
 * Who teaches in `period` of a day and where, from the school timetable. Everyone else who teaches that day is
 * listed with when they teach next: the image only knows lessons, so that's the closest to "is in school".
 */
export function teachersAt(day: Cell[], period: number): { teaching: Teaching[]; free: NotTeaching[] } {
  const now = new Map<string, Cell[]>();
  for (const c of day) if (c.teacher && c.period === period) now.set(c.teacher, [...(now.get(c.teacher) ?? []), c]);
  const teaching = [...now].map(([teacher, cells]) => ({
    teacher,
    subject: uniq(cells.map((c) => c.subject)).join(", "),
    classes: uniq(cells.map((c) => c.cls)),
    rooms: uniq(cells.map((c) => c.room)).sort((a, b) => a.localeCompare(b, "cs", { numeric: true })),
    changed: cells.some((c) => c.changed),
  }));
  const others = uniq(day.map((c) => c.teacher)).filter((t) => !now.has(t));
  const free = others.map((teacher) => {
    const later = day.filter((c) => c.teacher === teacher && c.period > period).map((c) => c.period);
    return { teacher, next: later.length ? Math.min(...later) : null };
  });
  // Those still teaching that day first, soonest on top; the ones done for the day last.
  free.sort((a, b) => (a.next ?? 99) - (b.next ?? 99) || byName(a, b));
  return { teaching: teaching.sort(byName), free };
}
