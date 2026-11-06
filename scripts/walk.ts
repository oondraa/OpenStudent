// Builds public/data/walk.json: the streets and paths of Hradec Králové a pedestrian can use, from OpenStreetMap
// (ODbL), as a compact graph. Výlety route walks (and nextbike rides) over it in the browser (src/shared/walkgraph.ts)
// instead of guessing from the straight line.
//
//   npx tsx scripts/walk.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { distance } from "../src/shared/transit";
import type { WalkData } from "../src/shared/walkgraph";

const OUT = "public/data/walk.json";
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

// The city with a margin: a trip may cut through Plotiště or Pouchov.
const BBOX = "50.155,15.74,50.26,15.93";
const WALKABLE = "footway|path|pedestrian|steps|residential|living_street|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|cycleway|track|road|corridor|bridleway";
const QUERY = `[out:json][timeout:180];
(
  way["highway"~"^(${WALKABLE})$"]["access"!~"^(private|no)$"]["foot"!~"^(no|private)$"]["area"!="yes"](${BBOX});
  way["highway"~"^(trunk|trunk_link)$"]["foot"~"^(yes|designated|permissive)$"](${BBOX});
  way["highway"~"^(trunk|trunk_link)$"]["sidewalk"~"^(both|left|right|yes)$"](${BBOX});
);
out body;
>;
out skel qt;`;

interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}
interface OsmWay {
  type: "way";
  id: number;
  nodes: number[];
  tags: Record<string, string>;
}

async function overpass(): Promise<(OsmNode | OsmWay)[]> {
  for (let round = 0; round < 4; round++) {
    for (const url of SERVERS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "OpenSISAKHK walk network export (github.com/oondraa/OpenSISAKHK)" },
          body: new URLSearchParams({ data: QUERY }),
          signal: AbortSignal.timeout(240_000),
        });
        if (res.ok) return ((await res.json()) as { elements: (OsmNode | OsmWay)[] }).elements;
        console.warn(`${url}: HTTP ${res.status}`);
      } catch (e) {
        console.warn(`${url}: ${(e as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 15_000 * 2 ** round));
  }
  throw new Error("Overpass: no server answered");
}

/** Steps are slower than their length: about twice. */
const STEPS = 2;

async function main() {
  const elements = await overpass();
  const coords = new Map<number, [number, number]>();
  const ways: OsmWay[] = [];
  for (const e of elements) {
    if (e.type === "node") coords.set(e.id, [e.lat, e.lon]);
    else ways.push(e);
  }

  // A graph node is where a way ends or ways meet; the points between stay as the edge's shape.
  const uses = new Map<number, number>();
  for (const w of ways) w.nodes.forEach((n, i) => uses.set(n, (uses.get(n) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
  const index = new Map<number, number>();
  const nodes: [number, number][] = [];
  const id = (n: number) => {
    let i = index.get(n);
    if (i === undefined) {
      i = nodes.length;
      index.set(n, i);
      nodes.push(coords.get(n)!);
    }
    return i;
  };

  type Edge = { a: number; b: number; cost: number; shape: [number, number][] };
  const edges: Edge[] = [];
  for (const w of ways) {
    const pts = w.nodes.filter((n) => coords.has(n));
    const factor = w.tags.highway === "steps" ? STEPS : 1;
    let start = 0;
    let length = 0;
    for (let i = 1; i < pts.length; i++) {
      length += distance(toPoint(coords.get(pts[i - 1])!), toPoint(coords.get(pts[i])!));
      if (i === pts.length - 1 || (uses.get(pts[i]) ?? 0) >= 2) {
        if (pts[start] !== pts[i] || i - start > 1)
          edges.push({ a: id(pts[start]), b: id(pts[i]), cost: length * factor, shape: pts.slice(start + 1, i).map((n) => coords.get(n)!) });
        start = i;
        length = 0;
      }
    }
  }

  // Keep the largest connected part: an isolated path (a courtyard, a fenced park) would strand a route.
  const adj: number[][] = nodes.map(() => []);
  for (const e of edges) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }
  const comp = new Int32Array(nodes.length).fill(-1);
  let biggest = -1;
  let biggestSize = 0;
  for (let s = 0, c = 0; s < nodes.length; s++) {
    if (comp[s] >= 0) continue;
    const stack = [s];
    comp[s] = c;
    let size = 0;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const v of adj[u]) if (comp[v] < 0) (comp[v] = c), stack.push(v);
    }
    if (size > biggestSize) (biggest = c), (biggestSize = size);
    c++;
  }
  const remap = new Int32Array(nodes.length).fill(-1);
  const keptNodes: [number, number][] = [];
  nodes.forEach((p, i) => {
    if (comp[i] === biggest) (remap[i] = keptNodes.length), keptNodes.push(p);
  });

  const q = (x: number) => Math.round(x * 1e5);
  const data: WalkData = {
    generated: new Date().toISOString(),
    source: "© OpenStreetMap contributors (ODbL)",
    nodes: keptNodes.flatMap(([lat, lon]) => [q(lat), q(lon)]),
    edges: edges
      .filter((e) => comp[e.a] === biggest)
      .map((e) => {
        // Shape points as differences from the previous point, in 1e-5 degrees (about a metre).
        const out = [remap[e.a], remap[e.b], Math.round(e.cost)];
        let prev = nodes[e.a];
        for (const p of e.shape) {
          out.push(q(p[0]) - q(prev[0]), q(p[1]) - q(prev[1]));
          prev = p;
        }
        return out;
      }),
  };
  mkdirSync("public/data", { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(OUT, json);
  console.log(`${OUT}: ${keptNodes.length} uzlů (z ${nodes.length}), ${data.edges.length} hran, ${(json.length / 1024).toFixed(0)} kB`);
}

const toPoint = ([lat, lon]: [number, number]) => ({ lat, lon });

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
