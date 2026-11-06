import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { codeHash, seal, unseal, type Session } from "./session";
import { isPushEndpoint, sendPush } from "./push";
import { TEST_FLAGS_HIDE, TEST_DAILY_MAX, TEST_KINDS, cleanNote, type TestItem, type TestKind } from "../shared/tests";
import { iredoDelays, mhdDepartures } from "./live";
import { parseCrowd } from "./menza";
import { StravaBadCredentials, StravaOrderRefused, changeOrder, checkLogin, fetchLunches, fetchMenu, fetchPublicMenu } from "./strava";
import { EMAIL, MailError, mailConfigured, sendMail } from "./mail";
import { DATASETS, addDays, edgeCache, classGroups, classWeek, dataset, putDataset, schoolDay, schools, timetableOf, type SchoolTimetable } from "./data";
import { notifyChanges } from "./notify";
import type { SchoolInfo } from "../shared/types";

type Bindings = {
  SESSION_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string;
  /** Shared with the GitHub Action that runs the pipeline and uploads its data. */
  INGEST_TOKEN: string;
  /** Gmail account + app password that sends the login codes (mail.ts). Without them: development mode. */
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_HOST?: string;
  /** "1" = return the login code to the client (local development only, never in production). */
  DEV_LOGIN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  DB: D1Database;
  LOGIN_IP_LIMIT?: RateLimit;
  LOGIN_USER_LIMIT?: RateLimit;
};
type Env = { Bindings: Bindings; Variables: { session: Session } };

const COOKIE = "ost";
const MAX_AGE = 400 * 24 * 3600;
const MAX_PUSH_DEVICES = 10;
const CODE_TTL = 10 * 60_000;
const CODE_ATTEMPTS = 5;
const CODE_RESEND = 45_000;

const app = new Hono<Env>().basePath("/api");

app.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !c.req.path.startsWith("/api/internal/")) {
    const origin = c.req.header("origin");
    if (c.req.header("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(c.req.url).origin))
      return c.json({ error: "forbidden" }, 403);
  }
  await next();
  c.res.headers.set("x-content-type-options", "nosniff");
  c.res.headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
  c.res.headers.set("referrer-policy", "no-referrer");
});

async function overLimit(limiter: RateLimit | undefined, key: string) {
  return limiter ? !(await limiter.limit({ key })).success : false;
}

async function sameSecret(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function readSession(c: Context<Env>) {
  const token = getCookie(c, COOKIE);
  return token ? await unseal<Session>(token, c.env.SESSION_SECRET, "session-cookie") : null;
}

async function writeSession(c: Context<Env>, s: Session) {
  setCookie(c, COOKIE, await seal(s, c.env.SESSION_SECRET, "session-cookie"), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/api",
    maxAge: MAX_AGE,
  });
}

const pragueToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());

/** Monday of the week containing `date`, or of the current week in Prague (Saturday and Sunday: the next one). */
function weekStart(date?: string): string {
  const explicit = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const d = new Date(`${explicit ? date : pragueToday()}T00:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + (!explicit && wd >= 5 ? 7 : 0));
  return d.toISOString().slice(0, 10);
}

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "upstream" }, 502);
});

// ---------- public ----------

/** Schools to pick from when signing up (no timetables, just names, classes and logos). */
app.get("/schools", async (c) => {
  const list = (await schools(c.env.DB)) ?? [];
  return c.json({ schools: list }, 200, { "cache-control": "public, max-age=600" });
});

/** Groups used in a class, for the optional "moje skupiny" step. */
app.get("/schools/:school/groups", async (c) => {
  const tt = await timetableOf(c.env.DB, c.req.param("school"));
  const cls = c.req.query("class") ?? "";
  return c.json({ groups: tt ? classGroups(tt, cls) : [] }, 200, { "cache-control": "public, max-age=600" });
});

/**
 * Step 1 of signing in: e-mail → a 6-digit code by e-mail. The same for a new and a returning student: whoever can
 * read the mailbox owns the account. Rate-limited per IP and per address.
 */
app.post("/auth/start", async (c) => {
  const { email: raw } = await c.req.json<{ email?: string }>().catch(() => ({ email: undefined }));
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return c.json({ error: "bad_email" }, 400);
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if ((await overLimit(c.env.LOGIN_IP_LIMIT, ip)) || (await overLimit(c.env.LOGIN_USER_LIMIT, `mail:${email}`)))
    return c.json({ error: "rate_limited" }, 429);
  const prev = await c.env.DB.prepare("SELECT sent FROM login_codes WHERE email = ?").bind(email).first<{ sent: number }>();
  if (prev && Date.now() - prev.sent < CODE_RESEND) return c.json({ error: "too_soon", wait: Math.ceil((CODE_RESEND - (Date.now() - prev.sent)) / 1000) }, 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await c.env.DB.prepare(
    "INSERT INTO login_codes (email, hash, expires, attempts, sent) VALUES (?1, ?2, ?3, 0, ?4) ON CONFLICT(email) DO UPDATE SET hash = ?2, expires = ?3, attempts = 0, sent = ?4",
  )
    .bind(email, await codeHash(c.env.SESSION_SECRET, email, code), Date.now() + CODE_TTL, Date.now())
    .run();
  if (mailConfigured(c.env)) {
    try {
      await sendMail(
        c.env,
        email,
        `${code} je tvůj kód do OpenŠtudentu`,
        `Ahoj,\n\ntvůj kód pro přihlášení do OpenŠtudentu je:\n\n    ${code}\n\nPlatí 10 minut. Pokud ses nepřihlašoval(a), tenhle e-mail ignoruj.\n\nOpenŠtudent – rozvrh, obědy a volné učebny pro školy v Hradci Králové`,
      );
    } catch (e) {
      console.error("mail", e instanceof MailError ? e.message : e);
      return c.json({ error: "mail_failed" }, 502);
    }
    return c.json({ ok: true });
  }
  console.log(`login code for ${email}: ${code}`);
  return c.json({ ok: true, dev: c.env.DEV_LOGIN === "1" ? code : undefined });
});

/** Step 2: the code → the session cookie. Creates the account on first sign-in. */
app.post("/auth/verify", async (c) => {
  const body = await c.req.json<{ email?: string; code?: string }>().catch(() => ({}) as { email?: string; code?: string });
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
  if (!EMAIL.test(email) || !/^\d{6}$/.test(code)) return c.json({ error: "bad_code" }, 400);
  const row = await c.env.DB.prepare("SELECT hash, expires, attempts FROM login_codes WHERE email = ?").bind(email).first<{ hash: string; expires: number; attempts: number }>();
  if (!row || row.expires < Date.now() || row.attempts >= CODE_ATTEMPTS) return c.json({ error: "code_expired" }, 400);
  if (!(await sameSecret(row.hash, await codeHash(c.env.SESSION_SECRET, email, code)))) {
    await c.env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
    return c.json({ error: "bad_code", left: CODE_ATTEMPTS - row.attempts - 1 }, 400);
  }
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(email),
    c.env.DB.prepare("INSERT INTO users (id, email, first_seen, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen").bind(
      crypto.randomUUID(),
      email,
      now,
      now,
    ),
  ]);
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  await writeSession(c, { userId: user!.id });
  return c.json({ ok: true });
});

app.post("/logout", async (c) => {
  const s = await readSession(c);
  if (s) await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(s.userId).run();
  deleteCookie(c, COOKIE, { path: "/api" });
  return c.json({ ok: true });
});

app.get("/push/key", (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY }));

/** Usage numbers for the promo site: aggregates only. */
app.get("/stats", async (c) => {
  const [total, bySchool] = await c.env.DB.batch<{ n: number; school?: string }>([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM users"),
    c.env.DB.prepare("SELECT school, COUNT(*) AS n FROM users WHERE school IS NOT NULL GROUP BY school"),
  ]);
  const per: Record<string, number> = {};
  for (const r of bySchool.results) per[r.school!] = r.n;
  c.header("access-control-allow-origin", "*");
  c.header("cache-control", "public, max-age=300");
  return c.json({ users: total.results[0]?.n ?? 0, schools: per });
});

/**
 * The canteen forecast for other apps (OpenSISAKHK reads jidelna-hradecka). Agreed contract: one canteen object with
 * date, generated, axis_from, axis_to, open, peak_wait, peak_eating, best, worst, series.{wait,eating} (+ typical).
 * A day without a forecast (weekend, holidays, stale file) → {"date", "closed": true}, never yesterday's numbers.
 */
app.get("/menza/:file{[a-z0-9:-]+\\.json}", async (c) => {
  const id = c.req.param("file").replace(/\.json$/, "");
  const m = await dataset<Record<string, unknown> & { canteens: Record<string, unknown>[] }>(c.env.DB, "menza");
  const today = pragueToday();
  const canteen = m?.canteens?.find((x) => x.id === id);
  c.header("cache-control", "public, max-age=3600");
  if (!m || !canteen) return c.json({ error: "not_found" }, 404);
  const { menu: _menu, ...rest } = canteen;
  const head = { date: m.date, generated: m.generated, axis_from: m.axis_from, axis_to: m.axis_to, lunch_dwell: m.lunch_dwell };
  if (m.date !== today) return c.json({ date: today, closed: true, typical: rest.typical ?? [] });
  return c.json({ ...head, ...rest });
});

/** When every class in the city finishes on a day (Kdo kdy končí). Public timetables only, so public too. */
app.get("/ends", async (c) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("date") ?? "") ? c.req.query("date")! : pragueToday();
  const all = (await dataset<Record<string, { school: string; size: number; classes: Record<string, string> }[]>>(c.env.DB, "ends")) ?? {};
  return c.json({ date, dates: Object.keys(all), schools: all[date] ?? [] }, 200, { "cache-control": "public, max-age=600" });
});

// ---------- internal: the pipeline (GitHub Action) uploads its data ----------

const internal = new Hono<Env>();
internal.use("/*", async (c, next) => {
  const auth = c.req.header("authorization") ?? "";
  if (!c.env.INGEST_TOKEN || !auth.startsWith("Bearer ") || !(await sameSecret(auth.slice(7), c.env.INGEST_TOKEN)))
    return c.json({ error: "forbidden" }, 403);
  await next();
});

internal.put("/data/:name", async (c) => {
  const name = c.req.param("name");
  if (!DATASETS.test(name)) return c.json({ error: "bad_name" }, 400);
  const body = await c.req.text();
  try {
    JSON.parse(body);
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  const hash = await putDataset(c.env.DB, name, body);
  // A school's timetable: tell its students what changed (in the background, the upload doesn't wait).
  if (name.startsWith("tt-")) c.executionCtx.waitUntil(notifyChanges(c.env, JSON.parse(body) as SchoolTimetable).catch((e) => console.error("notify", e)));
  return c.json({ ok: true, hash });
});

app.route("/internal", internal);

// ---------- authenticated ----------

app.use("/*", async (c, next) => {
  const s = await readSession(c);
  if (!s?.userId) return c.json({ error: "unauthenticated" }, 401);
  c.set("session", s);
  await next();
});

interface UserRow {
  email: string;
  name: string | null;
  school: string | null;
  class: string | null;
  groups: string;
  tests_blocked: number;
}
const userOf = (db: D1Database, id: string) =>
  db.prepare("SELECT email, name, school, class, groups, tests_blocked FROM users WHERE id = ?").bind(id).first<UserRow>();

async function schoolOf(db: D1Database, id: string | null): Promise<SchoolInfo | null> {
  if (!id) return null;
  return ((await schools(db)) ?? []).find((s) => s.id === id) ?? null;
}

app.get("/live/iredo", async (c) => c.json({ delays: await iredoDelays() }, 200, { "cache-control": "private, max-age=15" }));
app.get("/live/mhd", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat - 50.2) > 0.2 || Math.abs(lon - 15.83) > 0.3) return c.json({ error: "bad_place" }, 400);
  return c.json({ departures: await mhdDepartures(lat, lon) }, 200, { "cache-control": "private, max-age=15" });
});

app.get("/me", async (c) => {
  const { userId } = c.get("session");
  const u = await userOf(c.env.DB, userId);
  if (!u) {
    deleteCookie(c, COOKIE, { path: "/api" });
    return c.json({ error: "unauthenticated" }, 401);
  }
  await c.env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(Date.now(), userId).run();
  const push = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").bind(userId).first<{ n: number }>();
  return c.json({
    email: u.email,
    name: u.name,
    school: await schoolOf(c.env.DB, u.school),
    class: u.class,
    groups: JSON.parse(u.groups) as string[],
    pushDevices: push?.n ?? 0,
    strava: !!c.get("session").strava,
  });
});

/** School + class (+ groups, nickname). The class has to exist in the school's published timetable. */
app.post("/me/profile", async (c) => {
  const body = await c.req.json<{ school?: unknown; cls?: unknown; groups?: unknown; name?: unknown }>().catch(() => null);
  const { userId } = c.get("session");
  const cur = await userOf(c.env.DB, userId);
  if (!body || !cur) return c.json({ error: "bad_request" }, 400);
  const schoolId = typeof body.school === "string" ? body.school : cur.school;
  const school = await schoolOf(c.env.DB, schoolId);
  if (!school) return c.json({ error: "bad_school" }, 400);
  const cls = typeof body.cls === "string" ? body.cls : schoolId === cur.school ? cur.class : null;
  if (cls !== null && school.supported && !school.classes.includes(cls)) return c.json({ error: "bad_class" }, 400);
  const groups = Array.isArray(body.groups) ? body.groups.filter((g): g is string => typeof g === "string" && g.length <= 20).slice(0, 20) : JSON.parse(cur.groups);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) || null : cur.name;
  // Another school or class: the canteen account belongs to the old school's canteen.
  if (schoolId !== cur.school && c.get("session").strava) await writeSession(c, { ...c.get("session"), strava: undefined });
  await c.env.DB.prepare("UPDATE users SET school = ?, class = ?, groups = ?, name = ? WHERE id = ?")
    .bind(schoolId, cls, JSON.stringify(cls === cur.class && schoolId === cur.school ? groups : Array.isArray(body.groups) ? groups : []), name, userId)
    .run();
  return c.json({ ok: true });
});

/** Deletes the account and everything that belongs to it. */
app.post("/me/delete", async (c) => {
  const { userId } = c.get("session");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM test_flags WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM tests WHERE author = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
  deleteCookie(c, COOKIE, { path: "/api" });
  return c.json({ ok: true });
});

/** The student's own class timetable of a week, from the school's public timetable. */
app.get("/timetable", async (c) => {
  const week = weekStart(c.req.query("week"));
  const u = await userOf(c.env.DB, c.get("session").userId);
  if (!u?.school || !u.class) return c.json({ week, days: [], error: "no_class" });
  const tt = await timetableOf(c.env.DB, u.school);
  if (!tt) return c.json({ week, days: [], error: "no_data" });
  return c.json({ week, days: classWeek(tt, u.class, week, JSON.parse(u.groups)), fetched: tt.fetched, weeks: Object.keys(tt.weeks) });
});

/** The whole school's lessons of a week as cells (free rooms, teachers, home tiles). */
app.get("/school/week", async (c) => {
  const week = weekStart(c.req.query("week"));
  const u = await userOf(c.env.DB, c.get("session").userId);
  const tt = u?.school ? await timetableOf(c.env.DB, u.school) : null;
  if (!tt) return c.json({ week, days: [], periods: [] });
  return c.json({ week, periods: tt.periods, days: [0, 1, 2, 3, 4].map((i) => schoolDay(tt, addDays(week, i), week)) }, 200, { "cache-control": "private, max-age=300" });
});

// ---------- canteen (Strava.cz) ----------

async function canteenOf(c: Context<Env>) {
  const u = await userOf(c.env.DB, c.get("session").userId);
  return (await schoolOf(c.env.DB, u?.school ?? null))?.canteen ?? null;
}

app.post("/strava", async (c) => {
  const { jmeno, heslo } = await c.req.json<{ jmeno?: string; heslo?: string }>();
  if (typeof jmeno !== "string" || typeof heslo !== "string" || !jmeno || !heslo) return c.json({ error: "missing_fields" }, 400);
  if (await overLimit(c.env.LOGIN_USER_LIMIT, `strava:${c.get("session").userId}`)) return c.json({ error: "rate_limited" }, 429);
  const canteen = await canteenOf(c);
  if (!canteen?.strava) return c.json({ error: "no_canteen" }, 400);
  const strava = { cislo: canteen.strava, jmeno: jmeno.trim(), heslo };
  try {
    await checkLogin(strava);
  } catch (e) {
    if (e instanceof StravaBadCredentials) return c.json({ error: "strava_bad_credentials" }, 400);
    throw e;
  }
  await writeSession(c, { ...c.get("session"), strava });
  return c.json({ ok: true });
});

app.post("/strava/disconnect", async (c) => {
  await writeSession(c, { ...c.get("session"), strava: undefined });
  return c.json({ ok: true });
});

app.get("/lunch", async (c) => {
  const s = c.get("session");
  if (!s.strava) return c.json({ connected: false, days: [] });
  try {
    return c.json({ connected: true, days: await fetchLunches(s.strava) });
  } catch (e) {
    if (!(e instanceof StravaBadCredentials)) throw e;
    await writeSession(c, { ...s, strava: undefined });
    return c.json({ connected: false, days: [], error: "strava_bad_credentials" });
  }
});

/** The menu: with a connected account the orders too, without it the canteen's public menu. */
app.get("/canteen", async (c) => {
  const s = c.get("session");
  const canteen = await canteenOf(c);
  if (!s.strava) {
    if (!canteen?.strava) return c.json({ connected: false, canteen, balance: null, days: [] });
    const key = new Request(`https://menu.openstudent.internal/${canteen.strava}`);
    const hit = await edgeCache()?.match(key);
    const days = hit ? await hit.json() : await fetchPublicMenu(canteen.strava).catch(() => []);
    if (!hit) await edgeCache()?.put(key, new Response(JSON.stringify(days), { headers: { "cache-control": "max-age=3600" } }));
    return c.json({ connected: false, canteen, balance: null, days });
  }
  try {
    return c.json({ connected: true, canteen, ...(await fetchMenu(s.strava)) });
  } catch (e) {
    if (!(e instanceof StravaBadCredentials)) throw e;
    await writeSession(c, { ...s, strava: undefined });
    return c.json({ connected: false, canteen, balance: null, days: [], error: "strava_bad_credentials" });
  }
});

/** How busy the student's canteen will be (forecast from timetables, not a live count). */
app.get("/canteen/crowd", async (c) => {
  const canteen = await canteenOf(c);
  const m = await dataset(c.env.DB, "menza");
  return c.json(parseCrowd(m, pragueToday(), canteen?.id), 200, { "cache-control": "private, max-age=600" });
});

app.post("/canteen/order", async (c) => {
  const { date, veta } = await c.req.json<{ date?: string; veta?: string | null }>();
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(veta === null || (typeof veta === "string" && /^\d{1,10}$/.test(veta))))
    return c.json({ error: "bad_order" }, 400);
  const s = c.get("session");
  if (!s.strava) return c.json({ error: "strava_not_connected" }, 400);
  if (await overLimit(c.env.LOGIN_USER_LIMIT, `order:${s.userId}`)) return c.json({ error: "rate_limited" }, 429);
  try {
    return c.json({ connected: true, ...(await changeOrder(s.strava, date, veta)) });
  } catch (e) {
    if (e instanceof StravaOrderRefused) return c.json({ error: e.message }, 409);
    if (e instanceof StravaBadCredentials) return c.json({ error: "strava_bad_credentials" }, 400);
    throw e;
  }
});

// ---------- tests (shared with the class) ----------

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function classTests(db: D1Database, school: string, cls: string, from: string, to: string, userId: string): Promise<TestItem[]> {
  const rows = await db
    .prepare(
      `SELECT t.id, t.date, t.start, t.subject, t.grp, t.kind, t.note, t.author = ?1 AS mine, u.name AS author_name,
              (SELECT COUNT(*) FROM test_flags f WHERE f.test_id = t.id) AS flags,
              EXISTS (SELECT 1 FROM test_flags f WHERE f.test_id = t.id AND f.user_id = ?1) AS flagged
       FROM tests t LEFT JOIN users u ON u.id = t.author WHERE t.school = ?2 AND t.class = ?3 AND t.date BETWEEN ?4 AND ?5 ORDER BY t.date, t.created`,
    )
    .bind(userId, school, cls, from, to)
    .all<{ id: number; date: string; start: string; subject: string; grp: string; kind: TestKind; note: string; mine: number; author_name: string | null; flags: number; flagged: number }>();
  return rows.results
    .filter((r) => r.mine || r.flags < TEST_FLAGS_HIDE)
    .map((r) => ({
      id: r.id,
      date: r.date,
      start: r.start,
      subject: r.subject,
      group: r.grp,
      kind: r.kind,
      note: r.note,
      mine: !!r.mine,
      by: r.author_name,
      flagged: !!r.flagged,
      hidden: r.flags >= TEST_FLAGS_HIDE,
    }));
}

const UPCOMING_DAYS = 120;

async function upcoming(db: D1Database, u: UserRow, userId: string) {
  const today = pragueToday();
  return { class: u.class, tests: await classTests(db, u.school!, u.class!, today, addDays(today, UPCOMING_DAYS), userId) };
}

app.get("/tests", async (c) => {
  const { userId } = c.get("session");
  const week = weekStart(c.req.query("week"));
  const u = await userOf(c.env.DB, userId);
  if (!u?.school || !u.class) return c.json({ week, class: null, tests: [] });
  return c.json({ week, class: u.class, tests: await classTests(c.env.DB, u.school, u.class, week, addDays(week, 6), userId) });
});

app.get("/tests/upcoming", async (c) => {
  const { userId } = c.get("session");
  const u = await userOf(c.env.DB, userId);
  if (!u?.school || !u.class) return c.json({ class: null, tests: [] });
  return c.json(await upcoming(c.env.DB, u, userId));
});

/** Adds a test to a lesson that really is in the class's published timetable (nobody can fill another class's). */
app.post("/tests", async (c) => {
  const { userId } = c.get("session");
  const body = await c.req.json<{ date?: unknown; start?: unknown; subject?: unknown; group?: unknown; kind?: unknown; note?: unknown }>().catch(() => null);
  const { date, start, subject, group, kind } = body ?? {};
  if (!isDate(date) || typeof start !== "string" || typeof subject !== "string" || typeof group !== "string" || typeof kind !== "string" || !(kind in TEST_KINDS))
    return c.json({ error: "bad_request" }, 400);
  const today = pragueToday();
  if (date < today || date > addDays(today, UPCOMING_DAYS)) return c.json({ error: "bad_date" }, 400);
  const u = await userOf(c.env.DB, userId);
  if (!u?.school || !u.class) return c.json({ error: "no_class" }, 409);
  if (u.tests_blocked) return c.json({ error: "blocked" }, 403);
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tests WHERE author = ? AND created > ?").bind(userId, Date.now() - 24 * 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= TEST_DAILY_MAX) return c.json({ error: "rate_limited" }, 429);
  const tt = await timetableOf(c.env.DB, u.school);
  // Weeks the pipeline doesn't have (further ahead): the permanent pattern of the latest week it has decides.
  const days = tt ? classWeek(tt, u.class, weekStart(date)) : [];
  const fallback = tt && !days.length ? classWeek(tt, u.class, Object.keys(tt.weeks).sort().at(-1)!) : [];
  const wd = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const day = days.find((d) => d.date === date) ?? fallback[wd];
  const lesson = day?.lessons.find((l) => !l.cancelled && l.start === start && l.subject === subject && l.group === group);
  if (!lesson) return c.json({ error: "no_lesson" }, 400);
  const dup = await c.env.DB.prepare("SELECT 1 FROM tests WHERE school = ? AND class = ? AND date = ? AND start = ? AND subject = ? AND grp = ? AND kind = ?")
    .bind(u.school, u.class, date, start, subject, group, kind)
    .first();
  if (!dup)
    await c.env.DB.prepare("INSERT INTO tests (school, class, date, start, subject, grp, kind, note, author, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(u.school, u.class, date, start, subject, group, kind, cleanNote(body?.note), userId, Date.now())
      .run();
  return c.json(await upcoming(c.env.DB, u, userId));
});

app.post("/tests/:id{[0-9]+}/delete", async (c) => {
  const { userId } = c.get("session");
  const row = await c.env.DB.prepare("SELECT 1 FROM tests WHERE id = ? AND author = ?").bind(Number(c.req.param("id")), userId).first();
  if (!row) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("DELETE FROM tests WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json(await upcoming(c.env.DB, (await userOf(c.env.DB, userId))!, userId));
});

app.post("/tests/:id{[0-9]+}/flag", async (c) => {
  const { userId } = c.get("session");
  const id = Number(c.req.param("id"));
  const { on } = await c.req.json<{ on?: unknown }>().catch(() => ({ on: undefined }));
  const u = await userOf(c.env.DB, userId);
  const row = await c.env.DB.prepare("SELECT school, class, author FROM tests WHERE id = ?").bind(id).first<{ school: string; class: string; author: string }>();
  if (!row || !u?.class || row.school !== u.school || row.class !== u.class || row.author === userId) return c.json({ error: "not_found" }, 404);
  await (on === false
    ? c.env.DB.prepare("DELETE FROM test_flags WHERE test_id = ? AND user_id = ?").bind(id, userId)
    : c.env.DB.prepare("INSERT OR IGNORE INTO test_flags (test_id, user_id) VALUES (?, ?)").bind(id, userId)
  ).run();
  return c.json(await upcoming(c.env.DB, u, userId));
});

// ---------- push ----------

app.post("/push/subscribe", async (c) => {
  const { subscription } = await c.req.json<{ subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }>();
  const endpoint = subscription?.endpoint;
  const { p256dh, auth } = subscription?.keys ?? {};
  const key = (k: unknown, max: number) => typeof k === "string" && k.length > 0 && k.length <= max;
  if (typeof endpoint !== "string" || !isPushEndpoint(endpoint) || !key(p256dh, 200) || !key(auth, 100)) return c.json({ error: "bad_subscription" }, 400);
  const userId = c.get("session").userId;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, user_id, created, p256dh, auth) VALUES (?, ?, ?, ?, ?)").bind(endpoint, userId, Date.now(), p256dh, auth),
    c.env.DB.prepare(
      `DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint NOT IN
       (SELECT endpoint FROM push_subscriptions WHERE user_id = ?1 ORDER BY created DESC LIMIT ?2)`,
    ).bind(userId, MAX_PUSH_DEVICES),
  ]);
  return c.json({ ok: true });
});

app.post("/push/unsubscribe", async (c) => {
  const { endpoint } = await c.req.json<{ endpoint?: string }>();
  if (endpoint) await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, c.get("session").userId).run();
  return c.json({ ok: true });
});

app.post("/push/test", async (c) => {
  if (await overLimit(c.env.LOGIN_USER_LIMIT, `push:${c.get("session").userId}`)) return c.json({ error: "rate_limited" }, 429);
  const subs = await c.env.DB.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ?").bind(c.get("session").userId).all<{ endpoint: string }>();
  const valid = subs.results.filter((s) => isPushEndpoint(s.endpoint));
  const keys = { publicKey: c.env.VAPID_PUBLIC_KEY, privateJwk: c.env.VAPID_PRIVATE_JWK };
  await Promise.all(valid.map(({ endpoint }) => sendPush(endpoint, keys)));
  return c.json({ sent: valid.length });
});

// ---------- bug reports ----------

const REPORT_MAX = 2000;

app.post("/report", async (c) => {
  if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.TELEGRAM_CHAT_ID) return c.json({ error: "not_configured" }, 503);
  const { userId } = c.get("session");
  if (await overLimit(c.env.LOGIN_USER_LIMIT, `report:${userId}`)) return c.json({ error: "rate_limited" }, 429);
  const body = await c.req.json<{ kind?: string; text?: string; meta?: Record<string, unknown> }>().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > REPORT_MAX) return c.json({ error: "bad_text" }, 400);
  const kind = body?.kind === "idea" ? "Nápad" : "Chyba";
  const meta = body?.meta ?? {};
  const field = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string).slice(0, 200) : "?");
  const u = await userOf(c.env.DB, userId);
  const message = [`${kind} · ${u?.school ?? "?"} ${u?.class ?? ""}`, "", text, "", `verze ${field("version")} · ${field("screen")} · ${field("layout")} · ${field("display")}`, field("device")].join("\n");
  const res = await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: c.env.TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: true }),
  });
  if (!res.ok) return c.json({ error: "upstream" }, 502);
  return c.json({ ok: true });
});

export default { fetch: app.fetch } satisfies ExportedHandler<Bindings>;
export type { Bindings };
