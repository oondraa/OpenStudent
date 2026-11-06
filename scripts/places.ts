// Builds public/data/places.json: shops and shopping centres in Hradec Králové from OpenStreetMap (ODbL),
// the targets the Výlety screen offers besides a tap on the map.
//
//   npx tsx scripts/places.ts
import { mkdirSync, writeFileSync } from "node:fs";
import type { Place } from "../src/shared/places";

const OUT = "public/data/places.json";
// The main Overpass server turns queries away when busy; the mirrors carry the same data.
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

const QUERY = `[out:json][timeout:120];
area["name"="Hradec Králové"]["admin_level"="8"]->.city;
(
  nwr["shop"]["name"](area.city);
  nwr["amenity"~"^(cinema|cafe|fast_food|ice_cream|library|marketplace|pub|bar|biergarten|restaurant)$"]["name"](area.city);
  nwr["leisure"~"^(sports_centre|swimming_pool|fitness_centre|bowling_alley)$"]["name"](area.city);
);
out center tags;`;

interface Element {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

async function overpass(): Promise<Element[]> {
  for (let round = 0; round < 4; round++) {
    for (const url of SERVERS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "OpenSISAKHK places export (github.com/oondraa/OpenSISAKHK)" },
          body: new URLSearchParams({ data: QUERY }),
          signal: AbortSignal.timeout(150_000),
        });
        if (res.ok) return ((await res.json()) as { elements: Element[] }).elements;
        console.warn(`${url}: HTTP ${res.status}`);
      } catch (e) {
        console.warn(`${url}: ${(e as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 15_000 * 2 ** round));
  }
  throw new Error("Overpass: no server answered");
}

/** What kind of place, for the list's label and filters. */
function kindOf(t: Record<string, string>): string {
  if (t.shop) return t.shop;
  if (t.amenity) return t.amenity;
  return t.leisure;
}

async function main() {
  const elements = await overpass();
  const seen = new Set<string>();
  const places: Place[] = [];
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const name = e.tags.name.trim();
    // The same shop mapped as a node and as its building: keep one.
    const key = `${name}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push([name, kindOf(e.tags), Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6, e.tags.opening_hours ?? null]);
  }
  places.sort((a, b) => a[0].localeCompare(b[0], "cs"));
  mkdirSync("public/data", { recursive: true });
  const json = JSON.stringify({ generated: new Date().toISOString(), source: "© OpenStreetMap contributors (ODbL)", places });
  writeFileSync(OUT, json);
  console.log(`${OUT}: ${places.length} míst, ${places.filter((p) => p[4]).length} s otevírací dobou, ${(json.length / 1024).toFixed(0)} kB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
