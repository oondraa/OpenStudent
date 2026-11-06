// Journey planning for SideQuesty: city transport (DPMHK), nextbike and walking, computed on the phone.
// Data: public/data/transit.json (scripts/transit.ts). Times are minutes after midnight, Prague time.
// Walks go over the streets (walkgraph.ts, public/data/walk.json); without that data, from the straight line.
import { haversine, straightWalker, type Walker } from "./walkgraph";

export interface TransitData {
  generated: string;
  source: string;
  /** [public line ("11R", "Os 5180"), what runs it, CIS JŘ line number (regional buses)] */
  routes: ([string, Vehicle] | [string, Vehicle, number])[];
  /** [name, lat, lon] */
  stops: [string, number, number][];
  /** days: Mo…Su as "1111100"; from/to ISO dates; add/remove: exceptions */
  services: { days: string; from: string; to: string; add: string[]; remove: string[] }[];
  /** Stop indices a trip calls at, in order. */
  patterns: number[][];
  headsigns: string[];
  /** [route, service, pattern, headsign, times]; times = [first departure, then per next stop: Δ arrival, dwell] */
  trips: ([number, number, number, number, number[]] | [number, number, number, number, number[], number])[];
}

/** City bus and trolleybus (DPMHK), regional bus (IREDO, long-distance), train. */
export type Vehicle = "bus" | "trolleybus" | "regional" | "train";

export interface Point {
  name: string;
  lat: number;
  lon: number;
}

export type Leg =
  | { kind: "walk"; from: Point; to: Point; start: number; end: number; meters: number; path?: [number, number][] }
  | { kind: "ride"; line: string; vehicle: Vehicle; /** IREDO's id of the trip ("S-661115-12", "K-5180"), for live delays */ liveId?: string; headsign: string; from: Point; to: Point; start: number; end: number; stops: Point[] }
  | { kind: "bike"; from: Point; to: Point; start: number; end: number; meters: number; rentUrl?: string; path?: [number, number][] };

export type Mode = "walk" | "transit" | "bike";

export interface Journey {
  mode: Mode;
  legs: Leg[];
  /** Leave the starting point at… */
  start: number;
  /** …and arrive at the target at. */
  end: number;
}

/** Walking pace in metres a minute (4.5 km/h). */
export const WALK = 75;
/** City cycling, a little slower than a sports ride (15 km/h). */
export const BIKE = 250;
/** Unlocking a nextbike and returning it, together. */
export const BIKE_OVERHEAD = 3;
/** Time to change from one bus to another at the same stop. */
export const CHANGE = 1;
/** Farthest walk to or from a stop considered, and between two stops when changing. */
const ACCESS_METERS = 1500;
const TRANSFER_METERS = 450;
/** Longest nextbike ride considered. */
const RIDE_METERS = 15_000;

/** Straight-line distance in metres. */
export const distance = haversine;
export const walkMinutes = (meters: number) => Math.ceil(meters / WALK);

/** Transfers between stops depend only on the stops and the walker: worked out once, not per date. */
const footCache = new WeakMap<Walker, WeakMap<TransitData, { to: number; min: number }[][]>>();

/** Monday = 0 for an ISO date. */
const weekday = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

export function runsOn(s: TransitData["services"][number], iso: string) {
  if (s.remove.includes(iso)) return false;
  if (s.add.includes(iso)) return true;
  return s.from <= iso && iso <= s.to && s.days[weekday(iso)] === "1";
}

interface Connection {
  from: number;
  to: number;
  dep: number;
  arr: number;
  trip: number;
  /** Index of `from` in the trip's pattern (a loop line calls at a stop twice). */
  pos: number;
}

/** One day of the network, ready for queries. Build once per date (a few ms). */
export class Network {
  readonly stops: Point[];
  private readonly conns: Connection[] = [];
  private readonly trips: { route: number; headsign: number; pattern: number; cis?: number }[] = [];
  /** Walks between nearby stops (changing from one platform to another). */
  private readonly foot: { to: number; min: number }[][];

  constructor(
    private readonly data: TransitData,
    readonly date: string,
    private readonly walker: Walker = straightWalker,
  ) {
    this.stops = data.stops.map(([name, lat, lon]) => ({ name, lat, lon }));
    const active = data.services.map((s) => runsOn(s, date));
    for (const [route, service, pattern, headsign, t, cis] of data.trips) {
      if (!active[service]) continue;
      const trip = this.trips.length;
      this.trips.push({ route, headsign, pattern, cis });
      const seq = data.patterns[pattern];
      let dep = t[0];
      for (let i = 1; i < seq.length; i++) {
        const arr = dep + t[2 * i - 1];
        this.conns.push({ from: seq[i - 1], to: seq[i], dep, arr, trip, pos: i - 1 });
        dep = arr + t[2 * i];
      }
    }
    this.conns.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
    let byData = footCache.get(walker);
    if (!byData) footCache.set(walker, (byData = new WeakMap()));
    let foot = byData.get(data);
    if (!foot) {
      foot = this.stops.map((a, i) => {
        // Only stops in reach by air can be in reach on foot.
        const near = this.stops.map((b, j) => (j !== i && haversine(a, b) <= TRANSFER_METERS ? j : -1)).filter((j) => j >= 0);
        const meters = walker.many(a, near.map((j) => this.stops[j]), TRANSFER_METERS);
        return near.flatMap((j, k) => (Number.isFinite(meters[k]) ? [{ to: j, min: walkMinutes(meters[k]) }] : []));
      });
      byData.set(data, foot);
    }
    this.foot = foot;
  }

  get tripCount() {
    return this.trips.length;
  }

  /** First connection departing at or after `t` (binary search). */
  private firstAfter(t: number) {
    let lo = 0;
    let hi = this.conns.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.conns[mid].dep < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Earliest arrival from `from` to `to` leaving no sooner than `t`, walking and riding the buses
   * (Connection Scan Algorithm). null when walking the whole way is as fast.
   */
  earliest(from: Point, to: Point, t: number): Journey | null {
    const n = this.stops.length;
    const best = new Array<number>(n).fill(Infinity);
    // How each stop was reached: walking from the start, from another stop, or by a trip (boarded at `enter`).
    type Via = { kind: "start"; min: number; meters: number } | { kind: "foot"; from: number; min: number } | { kind: "ride"; enter: Connection; exit: Connection };
    const via = new Array<Via | undefined>(n);
    const boarded = new Map<number, Connection>();

    const egress: { stop: number; meters: number }[] = [];
    const reach = this.walker.many(from, this.stops, ACCESS_METERS);
    const exits = this.walker.many(to, this.stops, ACCESS_METERS);
    this.stops.forEach((_, i) => {
      const m = reach[i];
      if (Number.isFinite(m)) {
        best[i] = t + walkMinutes(m);
        via[i] = { kind: "start", min: walkMinutes(m), meters: m };
      }
      if (Number.isFinite(exits[i])) egress.push({ stop: i, meters: exits[i] });
    });
    const direct = this.walker.route(from, to).meters;
    let target = t + walkMinutes(direct);

    for (let k = this.firstAfter(t); k < this.conns.length; k++) {
      const c = this.conns[k];
      if (c.dep >= target) break; // nothing departing now can arrive sooner
      const on = boarded.has(c.trip);
      const v = via[c.from];
      const ready = best[c.from] + (v?.kind === "ride" ? CHANGE : 0);
      if (!on && ready > c.dep) continue;
      if (!on) boarded.set(c.trip, c);
      if (c.arr < best[c.to]) {
        best[c.to] = c.arr;
        via[c.to] = { kind: "ride", enter: boarded.get(c.trip)!, exit: c };
        for (const f of this.foot[c.to])
          if (c.arr + f.min < best[f.to]) {
            best[f.to] = c.arr + f.min;
            via[f.to] = { kind: "foot", from: c.to, min: f.min };
          }
        for (const e of egress) if (e.stop === c.to || this.foot[c.to].some((f) => f.to === e.stop)) target = Math.min(target, best[e.stop] + walkMinutes(e.meters));
      }
    }

    let end: { stop: number; meters: number } | null = null;
    let arrival = t + walkMinutes(direct);
    for (const e of egress) {
      const a = best[e.stop] + walkMinutes(e.meters);
      if (via[e.stop]?.kind !== "start" && a < arrival) {
        arrival = a;
        end = e;
      }
    }
    if (!end) return null;

    // Walk the pointers back from the last stop to the start.
    const legs: Leg[] = [];
    const lastStop = this.stops[end.stop];
    legs.push({ kind: "walk", from: lastStop, to, start: best[end.stop], end: arrival, meters: end.meters });
    let s = end.stop;
    for (let guard = 0; guard < 50; guard++) {
      const v = via[s]!;
      if (v.kind === "start") {
        legs.push({ kind: "walk", from, to: this.stops[s], start: best[s] - v.min, end: best[s], meters: v.meters });
        break;
      }
      if (v.kind === "foot") {
        legs.push({ kind: "walk", from: this.stops[v.from], to: this.stops[s], start: best[v.from], end: best[s], meters: this.walker.route(this.stops[v.from], this.stops[s]).meters });
        s = v.from;
        continue;
      }
      legs.push(this.ride(v.enter, v.exit));
      s = v.enter.from;
    }
    legs.reverse();
    // Leave as late as still catches the first bus: no standing at the stop for no reason.
    const first = legs.find((l) => l.kind === "ride")!;
    const access = legs[0].kind === "walk" ? legs[0] : null;
    if (access) {
      const walk = access.end - access.start;
      access.end = first.start;
      access.start = first.start - walk;
    }
    const merged = mergeWalks(legs.filter((l) => l.kind !== "walk" || l.meters > 0));
    for (const l of merged) if (l.kind === "walk") l.path = this.walker.route(l.from, l.to).path;
    return { mode: "transit", legs: merged, start: legs[0].start, end: arrival };
  }

  /** The leg of one trip from boarding at `enter` to getting off at the end of `exit`. */
  private ride(enter: Connection, exit: Connection): Leg {
    const trip = this.trips[enter.trip];
    const [line, vehicle, cisLine] = this.data.routes[trip.route];
    const liveId = vehicle === "train" ? `K-${line}` : vehicle === "regional" && cisLine && trip.cis ? `S-${cisLine}-${trip.cis}` : undefined;
    const seq = this.data.patterns[trip.pattern];
    const a = enter.pos;
    const b = exit.pos + 1;
    return {
      kind: "ride",
      line,
      vehicle,
      liveId,
      headsign: this.data.headsigns[trip.headsign],
      from: this.stops[enter.from],
      to: this.stops[exit.to],
      start: enter.dep,
      end: exit.arr,
      stops: seq.slice(a, b + 1).map((i) => this.stops[i]),
    };
  }

  /**
   * Latest time to leave `from` and still be at `to` by `deadline`, by bus; never before `notBefore`.
   * Arrival is monotone in the departure time, so a binary search over earliest() finds it.
   */
  latest(from: Point, to: Point, notBefore: number, deadline: number): Journey | null {
    const fits = (t: number) => {
      const j = this.earliest(from, to, t);
      return j && j.end <= deadline ? j : null;
    };
    let ok = fits(notBefore);
    if (!ok) return null;
    let lo = notBefore;
    let hi = deadline;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const j = fits(mid);
      if (j) {
        ok = j;
        lo = mid;
      } else hi = mid;
    }
    return ok;
  }
}

/** Two walks in a row (to a stop and on to the next one) read as one. */
function mergeWalks(legs: Leg[]): Leg[] {
  const out: Leg[] = [];
  for (const l of legs) {
    const prev = out[out.length - 1];
    if (prev?.kind === "walk" && l.kind === "walk") out[out.length - 1] = { ...prev, to: l.to, end: l.end, meters: prev.meters + l.meters };
    else out.push(l);
  }
  return out;
}

export function walkJourney(from: Point, to: Point, start: number, walker: Walker = straightWalker): Journey {
  const { meters, path } = walker.route(from, to);
  const end = start + walkMinutes(meters);
  return { mode: "walk", legs: [{ kind: "walk", from, to, start, end, meters, path }], start, end };
}

export interface BikeStation extends Point {
  id: string;
  bikes: number;
  rentUrl?: string;
}

/** Stations tried at each end: the nearest few on foot. */
const BIKE_CANDIDATES = 6;

/** Walk to a station with a bike, ride to a station near the target, walk the rest. */
export function bikeJourney(from: Point, to: Point, start: number, stations: BikeStation[], walker: Walker = straightWalker): Journey | null {
  const withBikes = stations.filter((s) => s.bikes > 0);
  if (!withBikes.length) return null;
  const nearest = (list: BikeStation[], meters: number[]) =>
    list
      .map((s, i) => ({ s, m: meters[i] }))
      .filter((x) => Number.isFinite(x.m))
      .sort((a, b) => a.m - b.m)
      .slice(0, BIKE_CANDIDATES);
  const starts = nearest(withBikes, walker.many(from, withBikes, ACCESS_METERS));
  const ends = nearest(stations, walker.many(to, stations, ACCESS_METERS));
  let best: { end: number; a: BikeStation; b: BikeStation; toA: number; ride: number; fromB: number } | null = null;
  for (const { s: a, m: toA } of starts) {
    const rides = walker.many(
      a,
      ends.map((e) => e.s),
      RIDE_METERS,
    );
    for (let k = 0; k < ends.length; k++) {
      const { s: b, m: fromB } = ends[k];
      if (b.id === a.id || !Number.isFinite(rides[k])) continue;
      const end = start + walkMinutes(toA) + Math.ceil(rides[k] / BIKE) + BIKE_OVERHEAD + walkMinutes(fromB);
      if (!best || end < best.end) best = { end, a, b, toA, ride: rides[k], fromB };
    }
  }
  if (!best) return null;
  const { a, b, toA, ride, fromB } = best;
  const t1 = start + walkMinutes(toA);
  const t2 = t1 + Math.ceil(ride / BIKE) + BIKE_OVERHEAD;
  const t3 = t2 + walkMinutes(fromB);
  const legs: Leg[] = [];
  if (toA > 0) legs.push({ kind: "walk", from, to: a, start, end: t1, meters: toA, path: walker.route(from, a).path });
  legs.push({ kind: "bike", from: a, to: b, start: t1, end: t2, meters: ride, rentUrl: a.rentUrl, path: walker.route(a, b).path });
  if (fromB > 0) legs.push({ kind: "walk", from: b, to, start: t2, end: t3, meters: fromB, path: walker.route(b, to).path });
  // Not worth it when walking is as quick.
  return t3 < walkJourney(from, to, start, walker).end ? { mode: "bike", start, end: t3, legs } : null;
}

/** A journey moved in time (walking and cycling take the same at any hour). */
export function shift(j: Journey, by: number): Journey {
  return { ...j, start: j.start + by, end: j.end + by, legs: j.legs.map((l) => ({ ...l, start: l.start + by, end: l.end + by })) };
}

/** Best way there for each mode, leaving at `t`. */
export function options(net: Network | null, from: Point, to: Point, t: number, stations: BikeStation[], walker: Walker = straightWalker): Journey[] {
  const out: Journey[] = [walkJourney(from, to, t, walker)];
  const transit = net?.earliest(from, to, t);
  if (transit) out.push(transit);
  const bike = bikeJourney(from, to, t, stations, walker);
  if (bike) out.push(bike);
  return out.sort((a, b) => a.end - b.end);
}

/** Latest way back for each mode to be at `to` by `deadline`, leaving no sooner than `notBefore`. */
export function returnOptions(
  net: Network | null,
  from: Point,
  to: Point,
  notBefore: number,
  deadline: number,
  stations: BikeStation[],
  walker: Walker = straightWalker,
): Journey[] {
  const out: Journey[] = [];
  const walk = walkJourney(from, to, 0, walker);
  if (deadline - walk.end >= notBefore) out.push(shift(walk, deadline - walk.end));
  const transit = net?.latest(from, to, notBefore, deadline);
  if (transit) out.push(transit);
  const bike = bikeJourney(from, to, 0, stations, walker);
  if (bike && deadline - bike.end >= notBefore) out.push(shift(bike, deadline - bike.end));
  return out.sort((a, b) => b.start - a.start);
}
