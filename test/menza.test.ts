import { describe, expect, it } from "vitest";
import { parseCrowd, parseCrowdDay } from "../src/worker/menza";

// Shape of OpenŠtudent's menza.json (2026-11-06 sample), series shortened to 20 minutes from 11:15.
const wait = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 10, 10, 10, 10, 10];
const eating = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 200, 200, 200, 200, 200];
const canteen = {
  id: "jidelna-hradecka",
  strava: "0288",
  open: ["11:15", "14:30"],
  peak_eating: { time: "13:49", count: 440 },
  peak_wait: { time: "13:44", min: 9.8 },
  best: [{ from: "11:15", to: "11:30", wait: 0.0, crowd: 0.03, score: 0.12 }],
  series: { arrivals: [], queue: [], wait, eating },
  menu: [{ kind: "Polévka", name: "x" }],
};
const file = { date: "2026-11-06", axis_from: "11:15", axis_to: "11:35", canteens: [{ id: "other", strava: "9999" }, canteen] };

describe("parseCrowd", () => {
  it("reads today's forecast of our canteen from the multi-canteen file, in 5-minute points", () => {
    const c = parseCrowd(file, "2026-11-06");
    expect(c.available).toBe(true);
    expect(c.date).toBe("2026-11-06");
    expect(c.today).toEqual({
      from: "11:15",
      open: ["11:15", "14:30"],
      wait: [0, 1, 4, 10],
      crowd: [0.1, 0.35, 0.6, 1],
      best: { from: "11:15", to: "11:30", wait: 0 },
      peakWait: { time: "13:44", min: 9.8 },
    });
  });

  it("doesn't show yesterday's file as today, but keeps the usual weekdays", () => {
    const typical = [{ weekday: 5, axis_from: "11:15", series: { wait, eating } }, { weekday: 9, axis_from: "11:15", series: { wait, eating } }];
    const c = parseCrowd({ ...canteen, date: "2026-11-05", axis_from: "11:15", typical }, "2026-11-06");
    expect(c.today).toBeNull();
    expect(Object.keys(c.typical)).toEqual(["5"]);
    expect(c.available).toBe(true);
  });

  it("is unavailable for junk, a closed day or nothing", () => {
    expect(parseCrowd(null, "2026-11-06").available).toBe(false);
    expect(parseCrowd({ date: "2026-11-06", closed: true }, "2026-11-06").available).toBe(false);
    expect(parseCrowdDay({ axis_from: "11:15", series: { wait: [1, 2], eating: [1] } })).toBeNull();
    expect(parseCrowdDay({ axis_from: "11:15", series: { wait: ["x"], eating: [1] } })).toBeNull();
  });
});
