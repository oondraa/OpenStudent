// Builds public/data/transit.json, the public transport in and around Hradec Králové the Výlety screen plans with:
// city buses and trolleybuses (DPMHK), regional buses (IREDO and long-distance) and trains.
//
// Source: the merged national timetables (CIS JŘ) in GTFS, published daily by Spojenka. The whole feed is ~80 MB
// zipped and ~400 MB unzipped, so it's streamed and only the stops inside AREA (and trips calling at two of them) kept.
//
//   npx tsx scripts/transit.ts            downloads the feed
//   GTFS_ZIP=path.zip npx tsx scripts/transit.ts   uses a feed already on disk
//
// The output is small (a few hundred kB, much less gzipped) and the browser plans the routes itself, offline.
import { createReadStream, openSync, readSync, closeSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInflateRaw } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { TransitData, Vehicle } from "../src/shared/transit";

const FEED = "https://spojenka.d3s.mff.cuni.cz/api/data/timetable/gtfs";
const MHD = "A173"; // Dopravní podnik města Hradce Králové, a.s.
/** The city with a margin, the same as the walking network (scripts/walk.ts). */
const AREA = { s: 50.155, w: 15.74, n: 50.26, e: 15.93 };
const inArea = (lat: number, lon: number) => lat >= AREA.s && lat <= AREA.n && lon >= AREA.w && lon <= AREA.e;
const OUT = "public/data/transit.json";

// --- A minimal zip reader: the central directory says where each file is, its data is raw deflate. ---

interface Entry {
  name: string;
  method: number;
  size: number;
  offset: number;
}

function zipEntries(path: string): Map<string, Entry> {
  const fd = openSync(path, "r");
  const total = statSync(path).size;
  const tailLen = Math.min(total, 65_557);
  const tail = Buffer.alloc(tailLen);
  readSync(fd, tail, 0, tailLen, total - tailLen);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("Not a zip file");
  const count = tail.readUInt16LE(eocd + 10);
  const dirSize = tail.readUInt32LE(eocd + 12);
  const dirOffset = tail.readUInt32LE(eocd + 16);
  const dir = Buffer.alloc(dirSize);
  readSync(fd, dir, 0, dirSize, dirOffset);
  const entries = new Map<string, Entry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    const method = dir.readUInt16LE(p + 10);
    const size = dir.readUInt32LE(p + 20);
    const nameLen = dir.readUInt16LE(p + 28);
    const extraLen = dir.readUInt16LE(p + 30);
    const commentLen = dir.readUInt16LE(p + 32);
    const local = dir.readUInt32LE(p + 42);
    const name = dir.toString("utf8", p + 46, p + 46 + nameLen);
    // The data starts after the local header, whose name and extra field lengths can differ from the directory's.
    const header = Buffer.alloc(30);
    readSync(fd, header, 0, 30, local);
    const offset = local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    entries.set(name, { name, method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  closeSync(fd);
  return entries;
}

/** Each CSV row of one file in the zip, as an object keyed by the header. */
async function* rows(zip: string, entries: Map<string, Entry>, file: string): AsyncGenerator<Record<string, string>> {
  const e = entries.get(file);
  if (!e) return;
  const raw = createReadStream(zip, { start: e.offset, end: e.offset + e.size - 1 });
  const input: Readable = e.method === 8 ? raw.pipe(createInflateRaw()) : raw;
  let head: string[] | null = null;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line) continue;
    const cells = csv(line);
    if (!head) {
      head = cells.map((c) => c.replace(/^﻿/, ""));
      continue;
    }
    const row: Record<string, string> = {};
    head.forEach((h, i) => (row[h] = cells[i] ?? ""));
    yield row;
  }
}

/** One CSV line (the feed has no line breaks inside quotes). */
function csv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const mins = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
/** "Hradec Králové, Terminál HD" → "Terminál HD"; stops outside the city keep their town. */
const stopName = (n: string) => n.replace(/^Hradec Králové,\s*/, "").trim();

async function main() {
  let zip = process.env.GTFS_ZIP;
  if (!zip) {
    zip = join(tmpdir(), "cisjr-gtfs.zip");
    console.log(`Stahuji ${FEED}…`);
    const res = await fetch(FEED, { headers: { "user-agent": "OpenSISAKHK transit export" } });
    if (!res.ok) throw new Error(`GTFS: HTTP ${res.status}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const entries = zipEntries(zip);

  // Platforms in the area (stations, location_type 1, only group them).
  const stopRows = new Map<string, { name: string; lat: number; lon: number }>();
  for await (const s of rows(zip, entries, "stops.txt")) {
    if (s.location_type === "1") continue;
    const lat = Number(s.stop_lat);
    const lon = Number(s.stop_lon);
    if (inArea(lat, lon)) stopRows.set(s.stop_id, { name: stopName(s.stop_name), lat, lon });
  }

  // Stop times at those platforms: the big file, streamed. A trip is kept if it calls at two of them.
  const times = new Map<string, { seq: number; stop: string; arr: number; dep: number }[]>();
  for await (const s of rows(zip, entries, "stop_times.txt")) {
    if (!stopRows.has(s.stop_id)) continue;
    // Stops a vehicle only passes (no boarding nor alighting) are useless for planning.
    if (s.pickup_type === "1" && s.drop_off_type === "1") continue;
    const list = times.get(s.trip_id) ?? [];
    list.push({ seq: Number(s.stop_sequence), stop: s.stop_id, arr: mins(s.arrival_time || s.departure_time), dep: mins(s.departure_time || s.arrival_time) });
    times.set(s.trip_id, list);
  }
  for (const [id, list] of times) if (list.length < 2) times.delete(id);

  // CIS JŘ numbers (relations "CISJR:661115", trips "CISJR:12"): IREDO's live map names a bus "S-661115-12".
  const cisOf = (rel: string | undefined) => Number(rel?.split("|").find((r) => r.startsWith("CISJR:"))?.slice(6)) || 0;
  const trips = new Map<string, { route: string; service: string; headsign: string; short: string; cis: number }>();
  for await (const t of rows(zip, entries, "trips.txt"))
    if (times.has(t.trip_id)) trips.set(t.trip_id, { route: t.route_id, service: t.service_id, headsign: t.trip_headsign, short: t.trip_short_name, cis: cisOf(t.relations) });
  const services = new Set([...trips.values()].map((t) => t.service));

  // Routes. City lines: the public number is in the long name ("MHD HRADEC KRÁLOVÉ linka: 11R …"), the short name
  // is the licence number (615311). Trains: each train has its own number ("Os 5180"), so a train is its own route.
  const routeRows = new Map<string, { line: string; kind: Vehicle; cis: number }>();
  const usedRoutes = new Set([...trips.values()].map((t) => t.route));
  for await (const r of rows(zip, entries, "routes.txt")) {
    if (!usedRoutes.has(r.route_id)) continue;
    const kind: Vehicle = r.route_type === "2" ? "train" : r.agency_id === MHD ? (r.route_type === "11" ? "trolleybus" : "bus") : "regional";
    const line =
      r.agency_id === MHD
        ? (r.route_long_name.match(/linka\s*:\s*(\S+)/i)?.[1] ?? r.route_short_name.replace(/^615(0)?/, ""))
        : r.route_short_name || r.route_long_name.slice(0, 12);
    routeRows.set(r.route_id, { line, kind, cis: cisOf(r.relations) });
  }
  const routes = new Map<string, { line: string; kind: Vehicle; cis: number }>();
  for (const t of trips.values()) {
    const r = routeRows.get(t.route);
    if (!r) continue;
    if (r.kind === "train" && t.short) {
      t.route = `${t.route}|${t.short}`;
      routes.set(t.route, { line: t.short, kind: "train", cis: 0 });
    } else routes.set(t.route, r);
  }
  const kinds = [...routes.values()].reduce<Record<string, number>>((acc, r) => ((acc[r.kind] = (acc[r.kind] ?? 0) + 1), acc), {});
  console.log(`${trips.size} spojů, linky: ${JSON.stringify(kinds)}`);

  // Only platforms some kept trip calls at.
  const usedStops = new Set([...times.values()].flat().map((s) => s.stop));
  for (const id of stopRows.keys()) if (!usedStops.has(id)) stopRows.delete(id);

  // The same platform appears under several ids (one per fare zone); same name and place = one stop.
  const stops: TransitData["stops"] = [];
  const stopIndex = new Map<string, number>();
  const byPlace = new Map<string, number>();
  for (const [id, s] of stopRows) {
    const key = `${s.name}|${s.lat.toFixed(5)}|${s.lon.toFixed(5)}`;
    let i = byPlace.get(key);
    if (i === undefined) {
      i = stops.length;
      stops.push([s.name, Math.round(s.lat * 1e6) / 1e6, Math.round(s.lon * 1e6) / 1e6]);
      byPlace.set(key, i);
    }
    stopIndex.set(id, i);
  }

  // Calendars: weekday mask and range, plus the exceptions (holidays, school breaks for the Š lines).
  const calendars = new Map<string, TransitData["services"][number]>();
  for await (const c of rows(zip, entries, "calendar.txt")) {
    if (!services.has(c.service_id)) continue;
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => c[d]).join("");
    calendars.set(c.service_id, { days, from: iso(c.start_date), to: iso(c.end_date), add: [], remove: [] });
  }
  for await (const c of rows(zip, entries, "calendar_dates.txt")) {
    if (!services.has(c.service_id)) continue;
    const cal = calendars.get(c.service_id) ?? { days: "0000000", from: iso(c.date), to: iso(c.date), add: [], remove: [] };
    (c.exception_type === "1" ? cal.add : cal.remove).push(iso(c.date));
    calendars.set(c.service_id, cal);
  }
  // Exceptions in the past are dead weight.
  const today = new Date().toISOString().slice(0, 10);
  const serviceIds = [...calendars.keys()];
  const serviceIndex = new Map(serviceIds.map((s, i) => [s, i]));
  const svc = serviceIds.map((id) => {
    const c = calendars.get(id)!;
    return { ...c, add: c.add.filter((d) => d >= today).sort(), remove: c.remove.filter((d) => d >= today).sort() };
  });

  const routeIds = [...routes.keys()];
  const routeIndex = new Map(routeIds.map((r, i) => [r, i]));
  const patterns: number[][] = [];
  const patternIndex = new Map<string, number>();
  const headsigns: string[] = [];
  const headsignIndex = new Map<string, number>();
  const out: TransitData["trips"] = [];
  for (const [id, trip] of trips) {
    const st = times.get(id);
    if (!st || st.length < 2 || !serviceIndex.has(trip.service) || !routes.has(trip.route)) continue;
    st.sort((a, b) => a.seq - b.seq);
    const seq = st.map((s) => stopIndex.get(s.stop)!);
    const pk = seq.join(",");
    let p = patternIndex.get(pk);
    if (p === undefined) {
      p = patterns.length;
      patterns.push(seq);
      patternIndex.set(pk, p);
    }
    const hs = stopName(trip.headsign);
    let h = headsignIndex.get(hs);
    if (h === undefined) {
      h = headsigns.length;
      headsigns.push(hs);
      headsignIndex.set(hs, h);
    }
    // Times as a start plus deltas: [first departure, Δ to next arrival, dwell, Δ, dwell, …]. Dwell is almost always 0.
    const t: number[] = [st[0].dep];
    for (let i = 1; i < st.length; i++) t.push(st[i].arr - st[i - 1].dep, st[i].dep - st[i].arr);
    const route = routes.get(trip.route)!;
    // Regional buses carry their CIS trip number, for matching the live delays (src/web/live.ts).
    if (route.kind === "regional" && route.cis && trip.cis) out.push([routeIndex.get(trip.route)!, serviceIndex.get(trip.service)!, p, h, t, trip.cis]);
    else out.push([routeIndex.get(trip.route)!, serviceIndex.get(trip.service)!, p, h, t]);
  }
  out.sort((a, b) => a[4][0] - b[4][0]);

  const data: TransitData = {
    generated: new Date().toISOString(),
    source: "CIS JŘ (GTFS, Spojenka MFF UK)",
    routes: routeIds.map((r) => {
      const x = routes.get(r)!;
      return x.kind === "regional" && x.cis ? [x.line, x.kind, x.cis] : [x.line, x.kind];
    }),
    stops,
    services: svc,
    patterns,
    headsigns,
    trips: out,
  };
  mkdirSync("public/data", { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(OUT, json);
  console.log(`${OUT}: ${stops.length} zastávek, ${patterns.length} tras, ${out.length} spojů, ${(json.length / 1024).toFixed(0)} kB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
