// Live delays for SideQuesty, from the public maps of the operators (unofficial interfaces, no CORS, so the
// Worker asks for the phones):
//   IREDO (regional buses and trains): https://iredo.online/map/mapData, every running trip with its delay.
//   DPMHK (city buses and trolleybuses): https://dpmhk.qrbus.me, departure boards of a stop with live times.
// Each answer is kept for LIVE_TTL in the edge cache, so the operators see a handful of requests a minute
// however many students look.

const LIVE_TTL = 15;
const LIST_TTL = 6 * 3600;
/** Hradec with a margin, the same area as the timetables (scripts/transit.ts). */
const AREA = { s: 50.155, w: 15.74, n: 50.26, e: 15.93 };
const DPMHK = "https://dpmhk.qrbus.me/index";
const UA = "OpenSISAKHK (school timetable app, github.com/oondraa/OpenSISAKHK)";

/** Fetches JSON through the edge cache: a stored answer younger than `ttl` seconds is used instead. */
async function cachedJson<T>(key: string, ttl: number, load: () => Promise<Response>): Promise<T> {
  const cache = (caches as unknown as { default: Cache }).default;
  const url = `https://live.opensisakhk.internal/${encodeURIComponent(key)}`;
  const hit = await cache.match(url);
  if (hit) return hit.json<T>();
  const res = await load();
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  const body = await res.text();
  await cache.put(url, new Response(body, { headers: { "content-type": "application/json", "cache-control": `max-age=${ttl}` } }));
  return JSON.parse(body) as T;
}

const timeout = () => AbortSignal.timeout(8000);

interface IredoConnection {
  id: string;
  delay?: number;
  time?: string;
}

/** Delays (minutes) of the regional trips running now, by IREDO id ("S-661115-12", "K-5180"). */
export async function iredoDelays(): Promise<Record<string, number>> {
  const data = await cachedJson<{ connections: IredoConnection[] | null }>("iredo", LIVE_TTL, () =>
    fetch("https://iredo.online/map/mapData", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({ ...AREA, zoom: 12 }),
      signal: timeout(),
    }),
  );
  const out: Record<string, number> = {};
  for (const c of data.connections ?? []) if (typeof c.delay === "number" && /^[SK]-[\d-]+$/.test(c.id)) out[c.id] = c.delay;
  return out;
}

const dpmhk = (path: string, body?: unknown) =>
  fetch(`${DPMHK}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-requested-with": "XMLHttpRequest", "content-type": "application/json", "user-agent": UA },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: timeout(),
  });

interface DpPlatform {
  id: number;
  stopId: number;
  lat: number;
  long: number;
}
interface DpDeparture {
  cancelled: boolean;
  /** Expected departure, epoch seconds. */
  departureDate: number;
  /** Planned departure, seconds after midnight (Prague). */
  plan: number;
  lineNumberText: string;
  realTimePaired: number;
}

/** Live departures from the DPMHK stop at a place: line, planned minute of the day, delay in seconds. */
export async function mhdDepartures(lat: number, lon: number): Promise<{ line: string; plan: number; delay: number }[]> {
  const platforms = await cachedJson<{ platforms?: DpPlatform[] }>("dpmhk-platforms", LIST_TTL, () => dpmhk("getAllPlatforms"));
  const all = platforms.platforms ?? [];
  // The nearest platform within 150 m (the timetables and DPMHK place them a few metres apart), then every
  // platform of its stop: the board is filtered by line and planned time anyway.
  let best: DpPlatform | null = null;
  let bestD = 150;
  for (const p of all) {
    const d = Math.hypot((p.lat / 1e5 - lat) * 111_320, (p.long / 1e5 - lon) * 71_400);
    if (d < bestD) (best = p), (bestD = d);
  }
  if (!best) return [];
  const stopId = best.stopId;
  const ids = all.filter((p) => p.stopId === stopId).map((p) => p.id).sort((a, b) => a - b);
  const deps = await cachedJson<{ departures?: DpDeparture[] }>(`dpmhk-dep-${ids.join(",")}`, LIVE_TTL, () => dpmhk("getDeparturesOnPlatformWeb", { platformIds: ids }));
  const out: { line: string; plan: number; delay: number }[] = [];
  for (const d of deps.departures ?? []) {
    if (d.cancelled || !d.realTimePaired) continue;
    // The expected time as Prague minutes of the day, against the plan (both wrap at midnight).
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .format(new Date(d.departureDate * 1000))
      .split(":")
      .map(Number);
    const expected = parts[0] * 3600 + parts[1] * 60 + parts[2];
    let delay = expected - d.plan;
    if (delay < -12 * 3600) delay += 86_400;
    if (delay > 12 * 3600) delay -= 86_400;
    if (Math.abs(delay) > 3 * 3600) continue; // nonsense the map shows for vehicles off the timetable
    out.push({ line: String(Number(d.lineNumberText) || d.lineNumberText), plan: Math.floor(d.plan / 60), delay });
  }
  return out;
}
