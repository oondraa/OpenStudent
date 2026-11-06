// The bell schedule of the student's school. OpenSISAKHK had Kyberna's hard-coded; here every school has its own,
// worked out by the pipeline from its timetable. The app calls setPeriods() once the school is known; importers read
// the live binding, so every screen follows.

export let PERIODS: [string, string][] = [
  ["8:00", "8:45"], ["8:55", "9:40"], ["10:00", "10:45"], ["10:55", "11:40"], ["11:50", "12:35"], ["12:45", "13:30"],
  ["13:40", "14:25"], ["14:35", "15:20"], ["15:30", "16:15"], ["16:25", "17:10"],
];

export function setPeriods(p: [string, string][] | undefined | null) {
  if (p && p.length) PERIODS = p;
}

const min = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Index of the period a lesson starting at `start` belongs to (the one it starts in, else the nearest). */
export function periodOf(start: string, periods: [string, string][] = PERIODS): number {
  const m = min(start);
  const inside = periods.findIndex(([s, e]) => min(s) <= m && m < min(e));
  if (inside >= 0) return inside;
  let best = 0;
  periods.forEach(([s], i) => {
    if (Math.abs(min(s) - m) < Math.abs(min(periods[best][0]) - m)) best = i;
  });
  return best;
}

/** The number a school gives period `i`: schools with an early "nultá hodina" (before 7:30) count from 0, others from 1. */
export function periodNumber(i: number, periods: [string, string][] = PERIODS): number {
  return periods.length && min(periods[0][0]) < 7 * 60 + 30 ? i : i + 1;
}
