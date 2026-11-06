// How busy a canteen will be: a forecast computed once a day by the pipeline (pipeline/openstudent/menza.py) from the
// public timetables of the schools that eat there, followed by a queue simulation. Not a live count: nobody publishes
// one. The same file feeds the public /api/menza/<id>.json that OpenSISAKHK reads.

const CROWD_TTL = 3600;
const FAIL_TTL = 600;
/** Minutes per point sent to the phones (the source has one per minute). */
export const STEP = 5;
const UA = "OpenSISAKHK/1.x (+github.com/oondraa/OpenSISAKHK)";

/** One day's forecast, sampled every STEP minutes from `from`. */
export interface CrowdDay {
  from: string; // "HH:MM", Prague
  open: [string, string] | null;
  /** expected queue wait in minutes */
  wait: number[];
  /** people seated, relative to the day's peak (0–1) */
  crowd: number[];
  best: { from: string; to: string; wait: number } | null;
  peakWait: { time: string; min: number } | null;
}

export interface Crowd {
  /** false when there's no forecast at all (no source configured, or it's down) */
  available: boolean;
  /** forecast for this date (Prague), null when the file is from another day */
  date: string | null;
  today: CrowdDay | null;
  /** a usual Monday … Friday (1–5), for the other days of the week */
  typical: Record<number, CrowdDay>;
}

const NONE: Crowd = { available: false, date: null, today: null, typical: {} };

const isTime = (v: unknown): v is string => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const nums = (v: unknown) => (Array.isArray(v) && v.every((x) => num(x) !== null) ? (v as number[]) : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Averages a per-minute series into STEP-minute points. */
function resample(series: number[]) {
  const out: number[] = [];
  for (let i = 0; i < series.length; i += STEP) {
    const part = series.slice(i, i + STEP);
    out.push(part.reduce((a, b) => a + b, 0) / part.length);
  }
  return out;
}

/** One canteen object (or a "typical" entry) of the OpenŠtudent file → CrowdDay, or null when it doesn't fit. */
export function parseCrowdDay(raw: unknown): CrowdDay | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const series = (r.series ?? {}) as Record<string, unknown>;
  const wait = nums(series.wait);
  const eating = nums(series.eating);
  if (!isTime(r.axis_from) || !wait || !eating || !wait.length || wait.length !== eating.length) return null;
  const peak = Math.max(...eating);
  const best = Array.isArray(r.best) ? (r.best[0] as Record<string, unknown> | undefined) : undefined;
  const pw = r.peak_wait as Record<string, unknown> | undefined;
  const open = Array.isArray(r.open) && r.open.length === 2 && r.open.every(isTime) ? (r.open as [string, string]) : null;
  return {
    from: r.axis_from,
    open,
    wait: resample(wait).map(round1),
    crowd: resample(eating).map((e) => (peak > 0 ? Math.round((e / peak) * 100) / 100 : 0)),
    best: best && isTime(best.from) && isTime(best.to) && num(best.wait) !== null ? { from: best.from, to: best.to, wait: round1(best.wait as number) } : null,
    peakWait: pw && isTime(pw.time) && num(pw.min) !== null ? { time: pw.time, min: round1(pw.min as number) } : null,
  };
}

/** The OpenŠtudent answer → Crowd. `today` is the Prague date: a file from another day isn't shown as today's. */
export function parseCrowd(raw: unknown, today: string, canteenId = "jidelna-hradecka"): Crowd {
  if (!raw || typeof raw !== "object") return NONE;
  const r = raw as Record<string, unknown>;
  // The agreed single-canteen object; the whole multi-canteen file works too.
  const canteen = Array.isArray(r.canteens) ? (r.canteens as Record<string, unknown>[]).find((c) => c?.id === canteenId) : r;
  if (!canteen) return NONE;
  const dated = r.date === today && !canteen.closed;
  const typical: Record<number, CrowdDay> = {};
  if (Array.isArray(canteen.typical))
    for (const t of canteen.typical as Record<string, unknown>[]) {
      const wd = num(t?.weekday);
      const day = wd !== null && wd >= 1 && wd <= 5 ? parseCrowdDay(t) : null;
      if (day) typical[wd!] = day;
    }
  const todayDay = dated ? parseCrowdDay({ ...canteen, axis_from: canteen.axis_from ?? r.axis_from }) : null;
  return { available: !!todayDay || Object.keys(typical).length > 0, date: todayDay ? today : null, today: todayDay, typical };
}

/** The forecast through the edge cache. Never throws: without it the Obědy screen simply has no crowd card. */
export async function fetchCrowd(source: string | undefined, today: string): Promise<Crowd> {
  if (!source) return NONE;
  const cache = (caches as unknown as { default: Cache }).default;
  const key = `https://menza.opensisakhk.internal/${encodeURIComponent(source)}`;
  const hit = await cache.match(key);
  let body: string;
  if (hit) body = await hit.text();
  else {
    try {
      const res = await fetch(source, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      // A day without data (weekend, holidays) is an answer too: cached as "nothing" for the full hour.
      body = res.ok ? await res.text() : res.status === 404 ? "null" : "";
    } catch {
      body = "";
    }
    const ttl = body ? CROWD_TTL : FAIL_TTL;
    await cache.put(key, new Response(body || "null", { headers: { "content-type": "application/json", "cache-control": `max-age=${ttl}` } }));
  }
  try {
    return parseCrowd(JSON.parse(body || "null"), today);
  } catch {
    return NONE;
  }
}
