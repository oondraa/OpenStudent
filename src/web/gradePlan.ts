import type { Grade } from "../worker/parse";

/**
 * Final grade from the average: under 1.5 is a 1, under 2.5 a 2 and so on. The school doesn't publish how it rounds a
 * x.50 exactly, so a target counts as reached only strictly under the line: the safe side.
 *
 * Grades are kept doubled (1- = 1.5 → 3) so every comparison is on integers and 2.50 is never read as 2.4999.
 */
const SCALE = [2, 3, 4, 5, 6, 7, 8, 9, 10]; // 1, 1-, 2, 2-, … 5, doubled

export const gradeLabel = (doubled: number) => `${Math.floor(doubled / 2)}${doubled % 2 ? "-" : ""}`;

/** Grades that count: a number (not "N", "x"…) and a weight. */
const counted = (grades: Grade[]) => grades.filter((g) => g.numeric !== null && g.weight !== null && g.weight > 0);

/** Weighted average the way SIS computes it, or null without a counted grade. */
export function average(grades: Grade[]): number | null {
  const gs = counted(grades);
  const w = gs.reduce((n, g) => n + g.weight!, 0);
  return w ? gs.reduce((n, g) => n + g.numeric! * g.weight!, 0) / w : null;
}

/** Final grade (1–5) the average leads to; x.50 already counts as the worse grade, as above. */
export const finalGrade = (avg: number) => Math.min(5, Math.max(1, Math.floor(avg + 0.5 + 1e-9)));

/** Weights the subject's grades have, most used first (ties: heavier first), for "the next test weighs …". */
export function weights(grades: Grade[]): number[] {
  const count = new Map<number, number>();
  for (const g of counted(grades)) count.set(g.weight!, (count.get(g.weight!) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([w]) => w);
}

export type Need =
  /** Any grade from the next test keeps the target, even a 5. */
  | { kind: "safe" }
  /** The worst grade (doubled) the next test can be. */
  | { kind: "grade"; worst: number }
  /** Even a 1 isn't enough: this many 1s of this weight in a row. */
  | { kind: "ones"; count: number };

/** What the next test(s) of weight `w` have to be for the subject to end on `target` (1–5). */
export function need(grades: Grade[], target: number, w: number): Need {
  if (target >= 5) return { kind: "safe" };
  const gs = counted(grades);
  const S = gs.reduce((n, g) => n + 2 * g.numeric! * g.weight!, 0);
  const W = gs.reduce((n, g) => n + g.weight!, 0);
  const T = 2 * target + 1; // the line, doubled: target 2 → under 2.5 → 5
  // (S + w·g) / (W + w) < T  ⇔  w·g < T·(W + w) − S
  const fits = (g: number) => w * g < T * (W + w) - S;
  const ok = SCALE.filter(fits);
  if (ok.length === SCALE.length) return { kind: "safe" };
  if (ok.length) return { kind: "grade", worst: ok[ok.length - 1] };
  // k ones: S + 2kw < T(W + kw)  ⇔  k·w·(T − 2) > S − T·W
  return { kind: "ones", count: Math.floor((S - T * W) / (w * (T - 2))) + 1 };
}
