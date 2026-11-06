// Walking (and nextbike riding) over the real streets and paths of Hradec Králové: public/data/walk.json
// (scripts/walk.ts, OpenStreetMap). A start or target is snapped onto the nearest street, then Dijkstra.

export interface WalkData {
  generated: string;
  source: string;
  /** lat, lon, lat, lon… in 1e-5 degrees */
  nodes: number[];
  /** [a, b, cost in metres, then shape points between a and b as Δlat, Δlon from the previous point (1e-5°)] */
  edges: number[][];
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** A walk found: its length (steps count double) and its line for the map. */
export interface WalkRoute {
  meters: number;
  path: [number, number][];
}

/** How walks are measured: over the streets (WalkGraph) or, without the data, from the straight line. */
export interface Walker {
  route(a: LatLon, b: LatLon): WalkRoute;
  /** Walking metres from `from` to each target, Infinity beyond `max`. */
  many(from: LatLon, targets: LatLon[], max: number): number[];
}

const R = 6_371_000;
const RAD = Math.PI / 180;
export function haversine(a: LatLon, b: LatLon) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Streets are about 1.3× longer than the straight line. */
export const DETOUR = 1.3;

/** The estimate without street data. */
export const straightWalker: Walker = {
  route: (a, b) => ({ meters: Math.round(haversine(a, b) * DETOUR), path: [[a.lat, a.lon], [b.lat, b.lon]] }),
  many: (from, targets, max) =>
    targets.map((t) => {
      const m = Math.round(haversine(from, t) * DETOUR);
      return m <= max ? m : Infinity;
    }),
};

/** Binary min-heap of node indices by distance. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): [number, number] {
    const { ids, keys } = this;
    const top: [number, number] = [ids[0], keys[0]];
    const id = ids.pop()!;
    const key = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const c = l + 1 < n && keys[l + 1] < keys[l] ? l + 1 : l;
        if (keys[c] >= key) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}

/** Where a point meets the network: on edge `edge`, `toA`/`toB` metres along it to its ends, `off` metres away from it. */
interface Snap {
  edge: number;
  toA: number;
  toB: number;
  off: number;
  /** The point on the street, and which shape segment it lies on (for drawing). */
  at: [number, number];
  seg: number;
}

/** Farther from any street than this, a point is walked to in a straight line. */
const MAX_SNAP = 400;
/** Grid cell for the snapping index, in degrees (about 220 m × 140 m). */
const CELL = 0.002;

export class WalkGraph implements Walker {
  private readonly lat: Float64Array;
  private readonly lon: Float64Array;
  /** Per edge: a, b, cost and its full line (a, shape…, b) as lat/lon pairs. */
  private readonly ea: Int32Array;
  private readonly eb: Int32Array;
  private readonly cost: Float64Array;
  private readonly lines: Float64Array[];
  /** Per edge: geometric length, so a snap's share of the cost can be prorated. */
  private readonly length: Float64Array;
  /** Adjacency: node → [edge…] */
  private readonly adj: number[][];
  private readonly grid = new Map<string, number[]>();
  private readonly memo = new Map<string, Float64Array>();

  constructor(data: WalkData) {
    const n = data.nodes.length / 2;
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.lat[i] = data.nodes[2 * i] / 1e5;
      this.lon[i] = data.nodes[2 * i + 1] / 1e5;
    }
    const m = data.edges.length;
    this.ea = new Int32Array(m);
    this.eb = new Int32Array(m);
    this.cost = new Float64Array(m);
    this.length = new Float64Array(m);
    this.lines = [];
    this.adj = Array.from({ length: n }, () => []);
    data.edges.forEach((e, k) => {
      const [a, b, c] = e;
      this.ea[k] = a;
      this.eb[k] = b;
      this.cost[k] = c;
      const line = [this.lat[a], this.lon[a]];
      let la = Math.round(this.lat[a] * 1e5);
      let lo = Math.round(this.lon[a] * 1e5);
      for (let i = 3; i + 1 < e.length; i += 2) {
        la += e[i];
        lo += e[i + 1];
        line.push(la / 1e5, lo / 1e5);
      }
      line.push(this.lat[b], this.lon[b]);
      const arr = Float64Array.from(line);
      this.lines.push(arr);
      let len = 0;
      for (let i = 2; i < arr.length; i += 2) {
        len += haversine({ lat: arr[i - 2], lon: arr[i - 1] }, { lat: arr[i], lon: arr[i + 1] });
        this.index(arr[i - 2], arr[i - 1], arr[i], arr[i + 1], k);
      }
      this.length[k] = len;
      this.adj[a].push(k);
      if (b !== a) this.adj[b].push(k);
    });
  }

  get nodeCount() {
    return this.lat.length;
  }

  /** Files a segment under every grid cell its bounding box touches. */
  private index(lat1: number, lon1: number, lat2: number, lon2: number, edge: number) {
    for (let x = Math.floor(Math.min(lat1, lat2) / CELL); x <= Math.floor(Math.max(lat1, lat2) / CELL); x++)
      for (let y = Math.floor(Math.min(lon1, lon2) / CELL); y <= Math.floor(Math.max(lon1, lon2) / CELL); y++) {
        const key = `${x},${y}`;
        const list = this.grid.get(key);
        if (!list) this.grid.set(key, [edge]);
        else if (list[list.length - 1] !== edge) list.push(edge);
      }
  }

  /** The nearest point on a street, looking at the cells around (rings outward until something is found). */
  private snap(p: LatLon): Snap | null {
    const cx = Math.floor(p.lat / CELL);
    const cy = Math.floor(p.lon / CELL);
    // Local flat projection in metres.
    const ky = R * RAD;
    const kx = R * RAD * Math.cos(p.lat * RAD);
    let best: Snap | null = null;
    let bestD = Infinity;
    for (let ring = 0; ring <= 3; ring++) {
      const seen = new Set<number>();
      for (let x = cx - ring; x <= cx + ring; x++)
        for (let y = cy - ring; y <= cy + ring; y++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) continue;
          for (const k of this.grid.get(`${x},${y}`) ?? []) {
            if (seen.has(k)) continue;
            seen.add(k);
            const line = this.lines[k];
            let along = 0;
            for (let i = 2; i < line.length; i += 2) {
              const ax = (line[i - 1] - p.lon) * kx;
              const ay = (line[i - 2] - p.lat) * ky;
              const bx = (line[i + 1] - p.lon) * kx;
              const by = (line[i] - p.lat) * ky;
              const dx = bx - ax;
              const dy = by - ay;
              const seg = Math.hypot(dx, dy);
              const t = seg ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (seg * seg))) : 0;
              const d = Math.hypot(ax + t * dx, ay + t * dy);
              if (d < bestD) {
                bestD = d;
                const frac = this.length[k] ? (along + t * seg) / this.length[k] : 0;
                best = {
                  edge: k,
                  toA: frac * this.cost[k],
                  toB: (1 - frac) * this.cost[k],
                  off: d,
                  at: [line[i - 2] + t * (line[i] - line[i - 2]), line[i - 1] + t * (line[i + 1] - line[i - 1])],
                  seg: i / 2 - 1,
                };
              }
              along += seg;
            }
          }
        }
      // A closer street can only be one ring further out than what's been looked at.
      if (best && bestD <= ring * Math.min(kx, ky) * CELL) break;
    }
    const found = best as Snap | null;
    return found && found.off <= MAX_SNAP ? found : null;
  }

  /** Dijkstra from a snapped point; distances to every node within `max`, and the edge each was reached by. */
  private search(s: Snap, max: number, stopAt?: (node: number) => boolean) {
    const n = this.lat.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new Heap();
    const a = this.ea[s.edge];
    const b = this.eb[s.edge];
    dist[a] = s.toA;
    heap.push(a, s.toA);
    if (s.toB < dist[b]) {
      dist[b] = s.toB;
      heap.push(b, s.toB);
    }
    while (heap.size) {
      const [u, d] = heap.pop();
      if (d > dist[u]) continue;
      if (d > max) break;
      if (stopAt?.(u)) break;
      for (const k of this.adj[u]) {
        const v = this.ea[k] === u ? this.eb[k] : this.ea[k];
        const nd = d + this.cost[k];
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = k;
          heap.push(v, nd);
        }
      }
    }
    return { dist, prev };
  }

  /** Metres from a search to a snapped target (via either end of its edge, or along the shared edge). */
  private reach(s: Snap, dist: Float64Array, t: Snap) {
    let m = Math.min(dist[this.ea[t.edge]] + t.toA, dist[this.eb[t.edge]] + t.toB);
    if (t.edge === s.edge) m = Math.min(m, Math.abs(t.toA - s.toA));
    return m;
  }

  many(from: LatLon, targets: LatLon[], max: number): number[] {
    const s = this.snap(from);
    if (!s) return straightWalker.many(from, targets, max);
    const key = `${from.lat.toFixed(6)},${from.lon.toFixed(6)},${max}`;
    let dist = this.memo.get(key);
    if (!dist) {
      dist = this.search(s, max).dist;
      if (this.memo.size > 64) this.memo.clear();
      this.memo.set(key, dist);
    }
    return targets.map((p) => {
      const t = this.snapCached(p);
      if (!t) return straightWalker.many(from, [p], max)[0];
      const m = Math.round(s.off + this.reach(s, dist, t) + t.off);
      return m <= max ? m : Infinity;
    });
  }

  private readonly snaps = new Map<string, Snap | null>();
  private snapCached(p: LatLon) {
    const key = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    let s = this.snaps.get(key);
    if (s === undefined) {
      s = this.snap(p);
      if (this.snaps.size > 4096) this.snaps.clear();
      this.snaps.set(key, s);
    }
    return s;
  }

  route(from: LatLon, to: LatLon): WalkRoute {
    const s = this.snapCached(from);
    const t = this.snapCached(to);
    if (!s || !t) return straightWalker.route(from, to);
    const ta = this.ea[t.edge];
    const tb = this.eb[t.edge];
    let doneA = false;
    let doneB = false;
    const { dist, prev } = this.search(s, Infinity, (u) => {
      if (u === ta) doneA = true;
      if (u === tb) doneB = true;
      return doneA && doneB;
    });
    const viaA = dist[ta] + t.toA;
    const viaB = dist[tb] + t.toB;
    const along = s.edge === t.edge ? Math.abs(t.toA - s.toA) : Infinity;
    const best = Math.min(viaA, viaB, along);
    if (!Number.isFinite(best)) return straightWalker.route(from, to);
    const path: [number, number][] = [[from.lat, from.lon], s.at];
    if (best === along) {
      path.push(t.at);
    } else {
      // Back from the target's edge end to the start's edge end, collecting the edges' lines.
      const end = best === viaA ? ta : tb;
      const chain: [number, number][][] = [];
      let u = end;
      for (let guard = 0; prev[u] >= 0 && guard < 100_000; guard++) {
        const k = prev[u];
        const line = this.points(k);
        chain.push(this.ea[k] === u ? line.reverse() : line);
        u = this.ea[k] === u ? this.eb[k] : this.ea[k];
      }
      // From the snap to the first node along the start edge.
      path.push(...this.partial(s, u));
      for (const line of chain.reverse()) path.push(...line);
      path.push(...this.partial(t, end).reverse());
      path.push(t.at);
    }
    path.push([to.lat, to.lon]);
    return { meters: Math.round(s.off + best + t.off), path: dedupe(path) };
  }

  /** An edge's line from a to b as points. */
  private points(k: number): [number, number][] {
    const line = this.lines[k];
    const out: [number, number][] = [];
    for (let i = 0; i < line.length; i += 2) out.push([line[i], line[i + 1]]);
    return out;
  }

  /** The line from a snapped point along its edge to the edge's end `node` (exclusive of the snap point). */
  private partial(s: Snap, node: number): [number, number][] {
    const pts = this.points(s.edge);
    return node === this.ea[s.edge] && node !== this.eb[s.edge] ? pts.slice(0, s.seg + 1).reverse() : pts.slice(s.seg + 1);
  }
}

function dedupe(path: [number, number][]) {
  return path.filter((p, i) => i === 0 || p[0] !== path[i - 1][0] || p[1] !== path[i - 1][1]);
}
