import { describe, expect, it } from "vitest";
import { WalkGraph, haversine, type WalkData } from "../src/shared/walkgraph";
import { Network, bikeJourney, returnOptions, runsOn, walkJourney, type TransitData } from "../src/shared/transit";
import { matchesPlace, openAt, parseHours, type Place } from "../src/shared/places";
import { pickReturn, verdict, windows, type Window } from "../src/shared/trips";

// A straight street running east: stops A, B, C about 1.4 km apart, one line A → B → C every 10 minutes.
const A = { name: "A", lat: 50.2, lon: 15.8 };
const B = { name: "B", lat: 50.2, lon: 15.82 };
const C = { name: "C", lat: 50.2, lon: 15.84 };
const D = { name: "D", lat: 50.2, lon: 15.843 }; // 210 m past C: a change on foot to line 2
const E = { name: "E", lat: 50.2, lon: 15.86 };

const data: TransitData = {
  generated: "2026-11-05T00:00:00Z",
  source: "test",
  routes: [
    ["1", "bus"],
    ["2", "trolleybus"],
  ],
  stops: [A, B, C, D, E].map((s) => [s.name, s.lat, s.lon]),
  services: [
    { days: "1111100", from: "2026-01-01", to: "2026-12-31", add: [], remove: ["2026-11-17"] },
    { days: "0000000", from: "2026-11-21", to: "2026-11-21", add: ["2026-11-21"], remove: [] },
  ],
  patterns: [
    [0, 1, 2],
    [3, 4],
  ],
  headsigns: ["C", "E"],
  trips: [
    ...[0, 10, 20, 30].map((k) => [0, 0, 0, 0, [8 * 60 + k, 3, 0, 3, 0]] as TransitData["trips"][number]),
    [1, 0, 1, 1, [8 * 60 + 20, 2, 0]],
    [0, 1, 0, 0, [9 * 60, 3, 0, 3, 0]],
  ],
};

describe("calendars", () => {
  it("runs on its weekdays, not on removed dates, and on added ones", () => {
    expect(runsOn(data.services[0], "2026-11-05")).toBe(true); // Thursday
    expect(runsOn(data.services[0], "2026-11-07")).toBe(false); // Saturday
    expect(runsOn(data.services[0], "2026-11-17")).toBe(false); // holiday
    expect(runsOn(data.services[1], "2026-11-21")).toBe(true);
  });
});

describe("journeys", () => {
  const net = new Network(data, "2026-11-05");

  it("takes the bus when it beats walking, and leaves only as early as needed", () => {
    const j = net.earliest(A, C, 8 * 60 + 2)!;
    expect(j.mode).toBe("transit");
    const ride = j.legs.find((l) => l.kind === "ride")!;
    expect(ride).toMatchObject({ line: "1", start: 8 * 60 + 10, end: 8 * 60 + 16 });
    expect(j.start).toBe(8 * 60 + 10);
    expect(j.end).toBe(8 * 60 + 16);
  });

  it("changes lines on foot between nearby stops", () => {
    const j = net.earliest(A, E, 8 * 60)!;
    const rides = j.legs.filter((l) => l.kind === "ride").map((l) => (l.kind === "ride" ? l.line : ""));
    expect(rides).toEqual(["1", "2"]);
    expect(j.end).toBe(8 * 60 + 22);
  });

  it("only runs trips of that day", () => {
    expect(new Network(data, "2026-11-07").tripCount).toBe(0);
    expect(new Network(data, "2026-11-21").tripCount).toBe(1);
  });

  it("finds the latest bus back that still arrives in time", () => {
    const back = returnOptions(net, A, C, 8 * 60, 8 * 60 + 27, []);
    const bus = back.find((j) => j.mode === "transit")!;
    expect(bus.end).toBeLessThanOrEqual(8 * 60 + 27);
    expect(bus.legs.find((l) => l.kind === "ride")!.start).toBe(8 * 60 + 20);
  });

  it("rides a nextbike from a station with bikes when it beats walking", () => {
    const stations = [
      { ...A, id: "a", bikes: 0 },
      { ...B, id: "b", bikes: 2 },
      { ...E, id: "e", bikes: 0 },
    ];
    const j = bikeJourney(B, E, 600, stations)!;
    expect(j.legs.map((l) => l.kind)).toEqual(["bike"]);
    expect(j.end).toBeLessThan(walkJourney(B, E, 600).end);
    expect(bikeJourney(A, E, 600, stations.map((s) => ({ ...s, bikes: 0 })))).toBeNull();
  });
});

describe("opening hours", () => {
  it("reads the common forms", () => {
    const w = parseHours("Mo-Fr 08:00-20:00; Sa 08:00-12:00; Su off")!;
    expect(w[0]).toEqual([[480, 1200]]);
    expect(w[5]).toEqual([[480, 720]]);
    expect(w[6]).toEqual([]);
    expect(parseHours("24/7")![3]).toEqual([[0, 1440]]);
    expect(parseHours("Mo,We 09:00-12:00,13:00-17:00")![2]).toEqual([
      [540, 720],
      [780, 1020],
    ]);
    expect(parseHours("09:00-21:00")![6]).toEqual([[540, 1260]]);
    expect(parseHours("Mo-Su 07:00-22:00; PH off")![6]).toEqual([[420, 1320]]);
  });

  it("gives up on what it can't read instead of guessing", () => {
    expect(parseHours("Mo-Fr sunrise-sunset")).toBeNull();
    expect(parseHours("Jan-Mar Mo-Fr 08:00-16:00")).toBeNull();
    expect(parseHours(null)).toBeNull();
  });

  it("knows open, closed and past midnight", () => {
    const w = parseHours("Mo-Su 18:00-02:00")!;
    expect(openAt(w, 0, 19 * 60)).toEqual({ open: true, closes: 26 * 60 });
    expect(openAt(w, 1, 60)).toEqual({ open: true, closes: 120 });
    expect(openAt(w, 1, 12 * 60)).toEqual({ open: false, opens: 18 * 60 });
  });
});

const lesson = (start: string, end: string, cancelled = false) => ({ start, end, cancelled });

describe("windows", () => {
  const day = {
    lessons: [lesson("08:00", "08:45"), lesson("08:55", "09:40"), lesson("10:35", "11:20"), lesson("12:20", "13:05"), lesson("13:10", "13:55", true)],
    lunch: { start: "11:20", end: "12:20" },
  };

  it("offers before school, free periods, lunch and after school for another day", () => {
    expect(windows(day, null).map((w) => [w.label, w.start, w.end, w.fromSchool])).toEqual([
      ["Před školou", 7 * 60, 8 * 60, false],
      ["Volno", 580, 635, true],
      ["Oběd", 680, 740, true],
      ["Po škole", 785, null, true], // the cancelled last lesson doesn't count
    ]);
  });

  it("today drops what's over and starts the current one now", () => {
    const w = windows(day, 9 * 60 + 50);
    expect(w.map((x) => [x.label, x.start])).toEqual([
      ["Volno", 590],
      ["Oběd", 680],
      ["Po škole", 785],
    ]);
  });

  it("during a lesson offers going now as skipping, back for the next lesson at the earliest", () => {
    const now = windows(day, 8 * 60 + 20)[0];
    expect(now).toMatchObject({ kind: "now", end: 8 * 60 + 55, fromSchool: false });
    expect(now.skip?.lessons[0]).toEqual({ start: 480, end: 525 });
    // Even with the next lesson 10 minutes away it's offered: you could come back for a later one.
    expect(windows(day, 9 * 60 + 30)[0]).toMatchObject({ kind: "now", end: 10 * 60 + 35 });
  });

  it("after school or without lessons it's just now, from where the phone is", () => {
    expect(windows(day, 15 * 60)).toEqual([{ kind: "now", label: "Teď", start: 900, end: null, fromSchool: false }]);
    expect(windows({ lessons: [], lunch: null }, 600)).toHaveLength(1);
    expect(windows({ lessons: [], lunch: null }, null)).toEqual([]);
  });
});

describe("verdict", () => {
  const go = (start: number, end: number) => ({ ...walkJourney(A, B, start), start, end });
  const gap: Window = { kind: "gap", label: "Volno", start: 580, end: 635, fromSchool: true };

  it("counts the minutes at the place between arriving and the last way back", () => {
    expect(verdict(gap, go(580, 590), go(615, 630), null, 0)).toMatchObject({ level: "ok", stay: 25 });
    expect(verdict(gap, go(580, 600), go(608, 630), null, 0)).toMatchObject({ level: "tight", stay: 8 });
    expect(verdict(gap, go(580, 610), go(612, 630), null, 0).level).toBe("no");
    expect(verdict(gap, go(580, 610), null, null, 0).level).toBe("no");
  });

  it("counts only the open part of the stay", () => {
    const hours = parseHours("Mo-Fr 10:00-18:00");
    expect(verdict(gap, go(580, 590), go(610, 630), hours, 0)).toMatchObject({ level: "tight", stay: 10 });
  });

  it("during a lesson never says stihneš, but finds the lesson to come back for", () => {
    const now = windows(
      { lessons: [lesson("08:00", "08:45"), lesson("08:55", "09:40"), lesson("09:50", "10:35"), lesson("10:45", "11:30")], lunch: null },
      8 * 60 + 20,
    )[0];
    const there = go(500, 505);
    // Back takes 15 minutes: 15 min there and back for 8:55; the trip is fine, but you are skipping.
    const backFor = (t: number) => go(t - 15, t);
    expect(pickReturn(now, there, backFor, null, 0)).toBe(535);
    const v = verdict({ ...now, end: 535 }, there, backFor(535), null, 0);
    expect(v).toMatchObject({ level: "tight", title: "Teď máš hodinu (do 8:45)" });
    expect(v.text).toContain("vrátíš se na hodinu v 8:55 (zameškáš hodinu)");
    expect(v.text).not.toContain("Stihneš");
    // A long way back: 8:55 doesn't work, 9:50 does (two lessons missed).
    const far = (t: number) => go(t - 45, t);
    expect(pickReturn(now, there, far, null, 0)).toBe(590);
    expect(verdict({ ...now, end: 590 }, there, far(590), null, 0).text).toContain("v 9:50 (zameškáš 2 hodiny)");
    // No way back for any lesson.
    expect(pickReturn(now, there, () => null, null, 0)).toBeNull();
    expect(verdict({ ...now, end: null }, there, null, null, 0)).toMatchObject({ level: "no" });
  });

  it("without a way back looks at closing time", () => {
    const after: Window = { kind: "after", label: "Po škole", start: 785, end: null, fromSchool: true };
    expect(verdict(after, go(785, 795), null, parseHours("Mo-Fr 08:00-13:10"), 0).level).toBe("no");
    expect(verdict(after, go(785, 795), null, parseHours("Mo-Fr 08:00-13:20"), 0).level).toBe("tight");
    expect(verdict(after, go(785, 795), null, parseHours("Mo-Fr 08:00-18:00"), 0).level).toBe("ok");
  });
});

describe("walk graph", () => {
  // An L-shaped street: A (south-west) → B (north-west) → C (north-east), plus a shaped edge C → D.
  const data: WalkData = {
    generated: "",
    source: "",
    nodes: [5020000, 1583000, 5020500, 1583000, 5020500, 1583700, 5020000, 1583700],
    edges: [
      [0, 1, 556],
      [1, 2, 499],
      [2, 3, 600, -250, 100, -250, -100],
    ],
  };
  const g = new WalkGraph(data);
  const near = (lat: number, lon: number) => ({ name: "", lat, lon });

  it("walks along the streets, not across", () => {
    const r = g.route(near(50.2, 15.83), near(50.205, 15.837));
    expect(r.meters).toBe(556 + 499);
    expect(r.path).toContainEqual([50.205, 15.83]);
    expect(haversine(near(50.2, 15.83), near(50.205, 15.837))).toBeLessThan(r.meters);
  });

  it("snaps a point onto the nearest street and follows the shape of a curved one", () => {
    const r = g.route(near(50.2025, 15.8301), near(50.2, 15.837));
    // Up half of A–B (about 278 m) after a step of about 7 m, across B–C, the whole of C–D.
    expect(r.meters).toBeGreaterThan(278 + 499 + 600);
    expect(r.meters).toBeLessThan(278 + 499 + 600 + 20);
    expect(r.path).toContainEqual([50.2025, 15.838]);
  });

  it("measures many targets at once, Infinity beyond the limit", () => {
    const [b, c] = g.many(near(50.2, 15.83), [near(50.205, 15.83), near(50.205, 15.837)], 800);
    expect(b).toBe(556);
    expect(c).toBe(Infinity);
  });

  it("falls back to the straight line far from any street", () => {
    const r = g.route(near(50.3, 15.9), near(50.31, 15.9));
    expect(r.path).toHaveLength(2);
  });
});

describe("place search", () => {
  const shop = (name: string, kind: string): Place => [name, kind, 50.2, 15.8, null];
  it("finds the corner shops as vietnamci and the malls as OC", () => {
    expect(matchesPlace(shop("Nguyen Tien Thanh", "convenience"), "vietnamci")).toBe(true);
    expect(matchesPlace(shop("Futurum HK", "department_store"), "oc")).toBe(true);
    expect(matchesPlace(shop("Kavárna U Mostu", "cafe"), "kafe")).toBe(true);
    expect(matchesPlace(shop("Nguyen Tien Thanh", "convenience"), "kafe")).toBe(false);
  });
});

describe("opening hours with commas between rules", () => {
  it("reads Na Hradě's hours", () => {
    const w = parseHours("Mo-Th 10:30-23:00, Fr 10:30-01:00, Sa 11:00-01:00, Su 11:00-23:00");
    expect(w).not.toBeNull();
    expect(openAt(w!, 0, 12 * 60).open).toBe(true);
  });
});
