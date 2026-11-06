import { describe, expect, it } from "vitest";
import { average, finalGrade, gradeLabel, need, weights } from "../src/web/gradePlan";
import type { Grade } from "../src/worker/parse";

const g = (numeric: number | null, weight: number | null) => ({ numeric, weight }) as Grade;

describe("gradePlan", () => {
  it("averages by weight and skips grades that don't count", () => {
    expect(average([g(1, 5), g(3, 1), g(null, 2), g(5, null)])).toBeCloseTo(8 / 6);
    expect(average([])).toBeNull();
    expect(finalGrade(2.49)).toBe(2);
    expect(finalGrade(2.5)).toBe(3);
  });

  it("orders weights by use", () => {
    expect(weights([g(1, 2), g(2, 5), g(3, 5), g(1, 1)])).toEqual([5, 2, 1]);
  });

  it("says the worst grade the next test can be", () => {
    // 2 and 3 at weight 1: avg 2.5. Target 2 with a weight-1 test: (5 + x) / 3 < 2.5 → x < 2.5 → worst 2
    expect(need([g(2, 1), g(3, 1)], 2, 1)).toEqual({ kind: "grade", worst: 4 });
    // target 3: (5 + x) / 3 < 3.5 → x < 5.5 → even a 5
    expect(need([g(2, 1), g(3, 1)], 3, 1)).toEqual({ kind: "safe" });
    expect(gradeLabel(5)).toBe("2-");
  });

  it("counts the 1s needed when one test isn't enough", () => {
    // 4 at weight 5 (avg 4), target 2 with weight-5 tests: (20 + 5k) / (5 + 5k) < 2.5 → k > 1 → 2 ones
    expect(need([g(4, 5)], 2, 5)).toEqual({ kind: "ones", count: 2 });
    // exactly on the line isn't enough: 3 at weight 1, target 2, one weight-1 test: (3 + x) / 2 < 2.5 → x < 2 → a 1-
    expect(need([g(3, 1)], 2, 1)).toEqual({ kind: "grade", worst: 3 });
    // 5 at weight 1, target 1: (5 + k) / (1 + k) < 1.5 → k > 7 → 8 ones
    expect(need([g(5, 1)], 1, 1)).toEqual({ kind: "ones", count: 8 });
  });

  it("works without any grade yet", () => {
    expect(need([], 1, 5)).toEqual({ kind: "grade", worst: 2 });
    expect(need([], 2, 5)).toEqual({ kind: "grade", worst: 4 });
  });
});
