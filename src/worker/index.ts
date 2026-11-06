import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { absenceStudentId, parseAbsence, parseElections, parseFinance, parseGrades, parseProfile, parseProjectChoices, parseProjects, parseTimetable } from "./parse";
import { CLASSES } from "../shared/schoolOcr";
import { BadCredentials, SessionExpired, get, getBinary, login, post, timetablePath, type Jar } from "./sis";
import { seal, unseal, type Session } from "./session";
import { SCHOOL_FILES, fetchSchoolImage, isTick, schoolWeeks, sha256 } from "./school";
import { isPushEndpoint, sendPush } from "./push";
import { TEST_FLAGS_HIDE, TEST_DAILY_MAX, TEST_KINDS, cleanNote, type TestItem, type TestKind } from "../shared/tests";
import { iredoDelays, mhdDepartures } from "./live";
import { fetchCrowd } from "./menza";
import { CANTEEN, StravaBadCredentials, StravaOrderRefused, changeOrder, checkLogin, fetchLunches, fetchMenu } from "./strava";

type Bindings = {
  SESSION_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string;
  /** Shared with the GitHub Action that reads the school timetable and sends targeted pushes. */
  INGEST_TOKEN: string;
  /** Fine-grained GitHub token allowed to trigger that Action (optional; without it the Action runs on its own schedule). */
  GITHUB_TOKEN?: string;
  GITHUB_REPO: string;
  /** Telegram bot that receives bug reports and ideas from Settings (optional; without it reporting is off). */
  TELEGRAM_BOT_TOKEN?: string;
  /** Chat the bot posts the reports to (the developer's own chat with the bot). */
  TELEGRAM_CHAT_ID?: string;
  DB: D1Database;
  /** Login attempts per IP; logins per SIS username, canteen logins and test pushes per student (wrangler.jsonc "ratelimits"). */
  LOGIN_IP_LIMIT?: RateLimit;
  LOGIN_USER_LIMIT?: RateLimit;
  /** OpenŠtudent's canteen crowd forecast (optional; without it the Obědy screen has no crowd card). */
  MENZA_URL?: string;
};
type Env = { Bindings: Bindings; Variables: { session: Session } };

const COOKIE = "osis";
const MAX_AGE = 400 * 24 * 3600; // browsers cap cookies at 400 days; refreshed on every SIS cookie change

const MAX_PUSH_DEVICES = 10;

const app = new Hono<Env>().basePath("/api");

app.use("*", async (c, next) => {
  // CSRF on top of SameSite=Strict: no state change from another site's page, whatever the content type.
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    if (c.req.header("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(c.req.url).origin))
      return c.json({ error: "forbidden" }, 403);
  }
  await next();
  // API responses are data: never sniffed into HTML, framed or rendered as a page.
  c.res.headers.set("x-content-type-options", "nosniff");
  c.res.headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
  c.res.headers.set("referrer-policy", "no-referrer");
});

/** True when `key` went over the limit (no binding, e.g. in tests: never). */
async function overLimit(limiter: RateLimit | undefined, key: string) {
  return limiter ? !(await limiter.limit({ key })).success : false;
}

/** Constant-time comparison of two secrets (their hashes, so the lengths match too). */
async function sameSecret(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** The session from the cookie. One sealed with the old shared key is sealed again with the cookie key. */
async function unsealCookie(c: Context<Env>) {
  const token = getCookie(c, COOKIE);
  const opened = token ? await unseal<Session>(token, c.env.SESSION_SECRET, "session-cookie") : null;
  if (opened?.legacy) await writeSession(c, opened.value);
  return opened?.value ?? null;
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

/** Runs `fn` against SIS; if the SIS session expired, logs in again with the stored credentials and retries once. */
async function withSis<T>(c: Context<Env>, fn: (s: Session) => Promise<{ value: T; changed: boolean }>): Promise<T> {
  const s = c.get("session");
  try {
    const { value, changed } = await fn(s);
    if (changed) await writeSession(c, s);
    return value;
  } catch (err) {
    if (!(err instanceof SessionExpired)) throw err;
    const fresh = await login(s.cred.u, s.cred.p); // BadCredentials here = password changed in SIS
    const next = { ...s, jar: fresh.jar };
    c.set("session", next);
    const { value } = await fn(next);
    await writeSession(c, next);
    return value;
  }
}

/** Monday of the week containing `date` (YYYY-MM-DD), or of the current week in Prague. */
function weekStart(date?: string): string {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());
  const d = new Date(`${date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

app.onError((err, c) => {
  if (err instanceof SessionExpired || err instanceof BadCredentials) {
    const loggingIn = c.req.path === "/api/login";
    if (!loggingIn) deleteCookie(c, COOKIE, { path: "/api" });
    return c.json({ error: loggingIn ? "bad_credentials" : "session_expired" }, 401);
  }
  console.error(err);
  // Details stay in the log: database and network errors would tell a client about the internals.
  return c.json({ error: "upstream" }, 502);
});

// ---------- public ----------

app.post("/login", async (c) => {
  const { username, password } = await c.req.json<{ username?: string; password?: string }>();
  if (typeof username !== "string" || typeof password !== "string" || !username || !password)
    return c.json({ error: "missing_fields" }, 400);
  // Without a limit the Worker would be an anonymous proxy for guessing SIS passwords.
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if ((await overLimit(c.env.LOGIN_IP_LIMIT, ip)) || (await overLimit(c.env.LOGIN_USER_LIMIT, `sis:${username.toLowerCase()}`)))
    return c.json({ error: "rate_limited" }, 429);
  const { jar, userId } = await login(username, password);
  // Logging in again (new password) keeps a connected Strava account of the same student.
  const old = await unsealCookie(c);
  const session: Session = { jar, userId, cred: { u: username, p: password }, strava: old?.userId === userId ? old.strava : undefined };
  await writeSession(c, session);
  c.executionCtx.waitUntil(saveProfile(c.env.DB, session).catch((e) => console.error("profile", e)));
  // Password changed in SIS: keep the background checks of an opted-in student working.
  await c.env.DB.prepare("UPDATE watchers SET cred = ? WHERE user_id = ?")
    .bind(await seal(session.cred, c.env.SESSION_SECRET, "watcher-cred"), userId)
    .run();
  return c.json({ ok: true });
});

app.post("/logout", async (c) => {
  const s = await unsealCookie(c);
  if (s)
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(s.userId),
      c.env.DB.prepare("DELETE FROM watchers WHERE user_id = ?").bind(s.userId),
    ]);
  deleteCookie(c, COOKIE, { path: "/api" });
  return c.json({ ok: true });
});

app.get("/school/weeks", async (c) => c.json({ weeks: await schoolWeeks() }));

app.get("/school/:file{[A-Z]{2}[12]\\.jpg}", async (c) => {
  const file = c.req.param("file").replace(".jpg", "");
  if (!SCHOOL_FILES.includes(file)) return c.notFound();
  const res = await fetchSchoolImage(file);
  if (!res.ok || res.headers.get("content-type") !== "image/jpeg") return c.json({ error: "upstream" }, 502);
  return new Response(res.body, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=120" } });
});

app.get("/push/key", (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY }));

/**
 * Public usage numbers for the promo site (GitHub Pages, a different origin — hence the CORS header). Aggregates
 * only: how many students use the app and how they split across classes. No names, no photos, nothing per-student.
 */
app.get("/stats", async (c) => {
  const [total, byClass] = await c.env.DB.batch<{ n: number; class?: string }>([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM users"),
    c.env.DB.prepare("SELECT class, COUNT(*) AS n FROM users WHERE class IS NOT NULL GROUP BY class"),
  ]);
  const classes: Record<string, number> = {};
  for (const r of byClass.results) classes[r.class!] = r.n;
  c.header("access-control-allow-origin", "*");
  c.header("cache-control", "public, max-age=300");
  return c.json({ users: total.results[0]?.n ?? 0, classes });
});

// ---------- internal: used by the GitHub Action (.github/workflows/watch.yml) ----------

const internal = new Hono<Env>();
internal.use("/*", async (c, next) => {
  const auth = c.req.header("authorization") ?? "";
  if (!c.env.INGEST_TOKEN || !auth.startsWith("Bearer ") || !(await sameSecret(auth.slice(7), c.env.INGEST_TOKEN)))
    return c.json({ error: "forbidden" }, 403);
  await next();
});

type Cred = Session["cred"];

/**
 * Opted-in students with at least one push subscription, with their login and the SIS session of the last check
 * (`jar`, null when there's none yet or it doesn't open) unsealed for scripts/watch.ts.
 */
internal.get("/watchers", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT w.user_id, w.cred, w.seen, w.sis, s.endpoint, s.p256dh, s.auth FROM watchers w
     JOIN push_subscriptions s ON s.user_id = w.user_id WHERE s.p256dh IS NOT NULL`,
  ).all<{ user_id: string; cred: string; seen: string | null; sis: string | null; endpoint: string; p256dh: string; auth: string }>();
  const byUser = new Map<
    string,
    { userId: string; cred: Cred | null; jar: Jar | null; seen: unknown; subscriptions: { endpoint: string; p256dh: string; auth: string }[] }
  >();
  const resealed: D1PreparedStatement[] = [];
  for (const r of rows.results) {
    let w = byUser.get(r.user_id);
    if (!w) {
      const opened = await unseal<Cred>(r.cred, c.env.SESSION_SECRET, "watcher-cred");
      // Logins stored with the old shared key move to the watcher key on the next check.
      if (opened?.legacy)
        resealed.push(
          c.env.DB.prepare("UPDATE watchers SET cred = ? WHERE user_id = ?").bind(await seal(opened.value, c.env.SESSION_SECRET, "watcher-cred"), r.user_id),
        );
      const jar = r.sis ? ((await unseal<Jar>(r.sis, c.env.SESSION_SECRET, "watcher-session"))?.value ?? null) : null;
      w = { userId: r.user_id, cred: opened?.value ?? null, jar, seen: r.seen ? JSON.parse(r.seen) : null, subscriptions: [] };
      byUser.set(r.user_id, w);
    }
    w.subscriptions.push({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth });
  }
  if (resealed.length) await c.env.DB.batch(resealed);
  return c.json({ watchers: [...byUser.values()].filter((w) => w.cred) });
});

internal.post("/watchers", async (c) => {
  const { seen, jars, drop, gone } = await c.req.json<{
    seen?: Record<string, unknown>;
    jars?: Record<string, Jar>;
    drop?: string[];
    gone?: string[];
  }>();
  const now = Date.now();
  const writes = [
    ...(await Promise.all(
      Object.entries(seen ?? {}).map(async ([id, s]) => {
        const jar = jars?.[id];
        // No session sent (an older script): the stored one stays.
        const sis = jar ? await seal(jar, c.env.SESSION_SECRET, "watcher-session") : null;
        return c.env.DB.prepare("UPDATE watchers SET seen = ?, checked = ?, sis = COALESCE(?, sis) WHERE user_id = ?").bind(JSON.stringify(s), now, sis, id);
      }),
    )),
    ...(drop ?? []).map((id) => c.env.DB.prepare("DELETE FROM watchers WHERE user_id = ?").bind(id)),
    ...(gone ?? []).map((e) => c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(e)),
  ];
  if (writes.length) await c.env.DB.batch(writes);
  return c.json({ ok: true });
});

app.route("/internal", internal);

// ---------- authenticated ----------

app.use("/*", async (c, next) => {
  const s = await unsealCookie(c);
  if (!s?.cred) return c.json({ error: "unauthenticated" }, 401);
  c.set("session", s);
  await next();
});

// SideQuesty: live delays (live.ts). Logged-in students only, so the operators' maps aren't an open proxy.
app.get("/live/iredo", async (c) => c.json({ delays: await iredoDelays() }, 200, { "cache-control": "private, max-age=15" }));
app.get("/live/mhd", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat - 50.2) > 0.2 || Math.abs(lon - 15.83) > 0.3) return c.json({ error: "bad_place" }, 400);
  return c.json({ departures: await mhdDepartures(lat, lon) }, 200, { "cache-control": "private, max-age=15" });
});

app.get("/me", async (c) => {
  const { userId } = c.get("session");
  const select = () =>
    c.env.DB.prepare("SELECT name, photo IS NOT NULL AS hasPhoto, groups IS NOT NULL AS hasProfile, class FROM users WHERE id = ?")
      .bind(userId)
      .first<{ name: string; hasPhoto: number; hasProfile: number; class: string | null }>();
  let row = await select();
  // Signed in before the profile had e-mail, groups, blocks and projects: read it once now.
  if (!row?.hasProfile) {
    await withSis(c, async (s) => ({ value: await saveProfile(c.env.DB, s), changed: false })).catch((e) => console.error("profile", e));
    row = await select();
  }
  await c.env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(Date.now(), userId).run();
  const push = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  const watching = await c.env.DB.prepare("SELECT 1 FROM watchers WHERE user_id = ?").bind(userId).first();
  return c.json({ name: row?.name ?? null, hasPhoto: !!row?.hasPhoto, class: row?.class ?? null, pushDevices: push?.n ?? 0, watching: !!watching, strava: !!c.get("session").strava });
});

/** The student's class, confirmed in the app (SIS doesn't show it). */
app.post("/me/class", async (c) => {
  const { cls } = await c.req.json<{ cls?: string }>();
  if (typeof cls !== "string" || !CLASSES.includes(cls)) return c.json({ error: "bad_class" }, 400);
  await c.env.DB.prepare("UPDATE users SET class = ? WHERE id = ?").bind(cls, c.get("session").userId).run();
  return c.json({ ok: true });
});

// ---------- canteen (Strava.cz) ----------

/** Connects the canteen account: checks the login, then keeps it in the session cookie only. */
app.post("/strava", async (c) => {
  const { jmeno, heslo } = await c.req.json<{ jmeno?: string; heslo?: string }>();
  if (typeof jmeno !== "string" || typeof heslo !== "string" || !jmeno || !heslo) return c.json({ error: "missing_fields" }, 400);
  if (await overLimit(c.env.LOGIN_USER_LIMIT, `strava:${c.get("session").userId}`)) return c.json({ error: "rate_limited" }, 429);
  const strava = { cislo: CANTEEN, jmeno: jmeno.trim(), heslo };
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

/** Ordered lunches for the next weeks; `connected: false` when no canteen account is linked (or its password changed). */
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

/** The whole menu with what's ordered and the account balance, for the Obědy screen. */
app.get("/canteen", async (c) => {
  const s = c.get("session");
  if (!s.strava) return c.json({ connected: false, balance: null, days: [] });
  try {
    return c.json({ connected: true, ...(await fetchMenu(s.strava)) });
  } catch (e) {
    if (!(e instanceof StravaBadCredentials)) throw e;
    await writeSession(c, { ...s, strava: undefined });
    return c.json({ connected: false, balance: null, days: [], error: "strava_bad_credentials" });
  }
});

/** How busy the canteen will be today and on a usual weekday: a forecast from timetables, not a live count. */
app.get("/canteen/crowd", async (c) => c.json(await fetchCrowd(c.env.MENZA_URL, pragueToday()), 200, { "cache-control": "private, max-age=600" }));

/**
 * Orders a meal for a day (switching from the ordered one), or cancels the day with `veta: null`. Real money:
 * the app asks first, the change is checked against a fresh read, and the answer is the menu as Strava has it after.
 */
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

/**
 * Tuition and fund statement. Read-only and never stored: not in D1, not logged, and the browser is told not to
 * keep it (the app doesn't cache it either).
 */
app.get("/finance", async (c) => {
  const html = await withSis(c, async (s) => {
    const { html, changed } = await get(s.jar, "/Finance/Info");
    return { value: html, changed };
  });
  c.header("cache-control", "no-store");
  return c.json(parseFinance(html));
});

/** Opt in/out of background checks for new grades and absences: stores or deletes the sealed SIS login. */
app.post("/watch", async (c) => {
  const { on } = await c.req.json<{ on?: boolean }>();
  const s = c.get("session");
  if (on)
    await c.env.DB.prepare(
      "INSERT INTO watchers (user_id, cred, created) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET cred = excluded.cred",
    )
      .bind(s.userId, await seal(s.cred, c.env.SESSION_SECRET, "watcher-cred"), Date.now())
      .run();
  else await c.env.DB.prepare("DELETE FROM watchers WHERE user_id = ?").bind(s.userId).run();
  return c.json({ ok: true });
});

app.get("/me/photo", async (c) => {
  const row = await c.env.DB.prepare("SELECT photo, photo_type FROM users WHERE id = ?")
    .bind(c.get("session").userId)
    .first<{ photo: ArrayBuffer | null; photo_type: string | null }>();
  if (!row?.photo) return c.notFound();
  // Only raster types: an SVG from SIS would run as a page on this origin.
  const type = /^image\/(jpeg|png|webp|gif)\b/.test(row.photo_type ?? "") ? row.photo_type! : "image/jpeg";
  return new Response(new Uint8Array(row.photo), {
    headers: { "content-type": type, "cache-control": "private, max-age=86400" },
  });
});

app.get("/timetable", async (c) => {
  const week = weekStart(c.req.query("week"));
  const permanent = c.req.query("static") === "1";
  const html = await withSis(c, async (s) => {
    const { html, changed } = await get(s.jar, timetablePath(s.userId, week, permanent));
    return { value: html, changed };
  });
  return c.json({ week, days: parseTimetable(html, week) });
});

// ---------- tests (shared with the class) ----------

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const pragueToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());

async function classOf(db: D1Database, userId: string) {
  return (await db.prepare("SELECT class, tests_blocked FROM users WHERE id = ?").bind(userId).first<{ class: string | null; tests_blocked: number }>()) ?? null;
}

/** The class's tests from `from` to `to` (dates), as this student sees them. */
async function classTests(db: D1Database, cls: string, from: string, to: string, userId: string): Promise<TestItem[]> {
  const rows = await db
    .prepare(
      `SELECT t.id, t.date, t.start, t.subject, t.grp, t.kind, t.note, t.author = ?1 AS mine, u.name AS author_name,
              (SELECT COUNT(*) FROM test_flags f WHERE f.test_id = t.id) AS flags,
              EXISTS (SELECT 1 FROM test_flags f WHERE f.test_id = t.id AND f.user_id = ?1) AS flagged
       FROM tests t LEFT JOIN users u ON u.id = t.author WHERE t.class = ?2 AND t.date BETWEEN ?3 AND ?4 ORDER BY t.date, t.created`,
    )
    .bind(userId, cls, from, to)
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

app.get("/tests", async (c) => {
  const { userId } = c.get("session");
  const week = weekStart(c.req.query("week"));
  const me = await classOf(c.env.DB, userId);
  if (!me?.class) return c.json({ week, class: null, tests: [] });
  return c.json({ week, class: me.class, tests: await classTests(c.env.DB, me.class, week, addDays(week, 6), userId) });
});

const UPCOMING_DAYS = 120;

/** The class's tests from today on, for the Testy screen. */
async function upcoming(db: D1Database, cls: string, userId: string) {
  const today = pragueToday();
  return { class: cls, tests: await classTests(db, cls, today, addDays(today, UPCOMING_DAYS), userId) };
}

app.get("/tests/upcoming", async (c) => {
  const { userId } = c.get("session");
  const me = await classOf(c.env.DB, userId);
  if (!me?.class) return c.json({ class: null, tests: [] });
  return c.json(await upcoming(c.env.DB, me.class, userId));
});

/**
 * Adds a test to one of the student's own lessons. The lesson is looked up in their SIS timetable, so a test can only
 * land where the author really has the lesson: nobody can fill another class's (or group's) timetable.
 */
app.post("/tests", async (c) => {
  const { userId } = c.get("session");
  const body = await c.req.json<{ date?: unknown; start?: unknown; subject?: unknown; group?: unknown; kind?: unknown; note?: unknown }>().catch(() => null);
  const { date, start, subject, group, kind } = body ?? {};
  if (!isDate(date) || typeof start !== "string" || typeof subject !== "string" || typeof group !== "string" || typeof kind !== "string" || !(kind in TEST_KINDS))
    return c.json({ error: "bad_request" }, 400);
  const today = pragueToday();
  if (date < today || date > addDays(today, UPCOMING_DAYS)) return c.json({ error: "bad_date" }, 400);
  const me = await classOf(c.env.DB, userId);
  if (!me?.class) return c.json({ error: "no_class" }, 409);
  if (me.tests_blocked) return c.json({ error: "blocked" }, 403);
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tests WHERE author = ? AND created > ?")
    .bind(userId, Date.now() - 24 * 3600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= TEST_DAILY_MAX) return c.json({ error: "rate_limited" }, 429);

  const html = await withSis(c, async (s) => {
    const { html, changed } = await get(s.jar, timetablePath(s.userId, weekStart(date)));
    return { value: html, changed };
  });
  const day = parseTimetable(html, weekStart(date)).find((d) => d.date === date);
  const lesson = day?.lessons.find((l) => !l.cancelled && l.start === start && l.subject === subject && l.group === group);
  if (!lesson) return c.json({ error: "no_lesson" }, 400);
  const dup = await c.env.DB.prepare("SELECT 1 FROM tests WHERE class = ? AND date = ? AND start = ? AND subject = ? AND grp = ? AND kind = ?")
    .bind(me.class, date, start, subject, group, kind)
    .first();
  if (!dup)
    await c.env.DB.prepare("INSERT INTO tests (class, date, start, subject, grp, kind, note, author, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(me.class, date, start, subject, group, kind, cleanNote(body?.note), userId, Date.now())
      .run();
  return c.json(await upcoming(c.env.DB, me.class, userId));
});

/** The author takes their test back. */
app.post("/tests/:id{[0-9]+}/delete", async (c) => {
  const { userId } = c.get("session");
  const row = await c.env.DB.prepare("SELECT date, class FROM tests WHERE id = ? AND author = ?").bind(Number(c.req.param("id")), userId).first<{ date: string; class: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("DELETE FROM tests WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json(await upcoming(c.env.DB, row.class, userId));
});

/** A classmate says the test doesn't hold (or takes that back). Enough of them hide it. */
app.post("/tests/:id{[0-9]+}/flag", async (c) => {
  const { userId } = c.get("session");
  const id = Number(c.req.param("id"));
  const { on } = await c.req.json<{ on?: unknown }>().catch(() => ({ on: undefined }));
  const me = await classOf(c.env.DB, userId);
  const row = await c.env.DB.prepare("SELECT date, class, author FROM tests WHERE id = ?").bind(id).first<{ date: string; class: string; author: string }>();
  if (!row || !me?.class || row.class !== me.class || row.author === userId) return c.json({ error: "not_found" }, 404);
  await (on === false
    ? c.env.DB.prepare("DELETE FROM test_flags WHERE test_id = ? AND user_id = ?").bind(id, userId)
    : c.env.DB.prepare("INSERT OR IGNORE INTO test_flags (test_id, user_id) VALUES (?, ?)").bind(id, userId)
  ).run();
  return c.json(await upcoming(c.env.DB, row.class, userId));
});

app.get("/grades", async (c) => {
  const html = await withSis(c, async (s) => {
    const { html, changed } = await get(s.jar, "/Classification/Student");
    return { value: html, changed };
  });
  return c.json({ subjects: parseGrades(html) });
});

app.get("/absence", async (c) => {
  const { page, summary } = await withSis(c, async (s) => {
    const page = await get(s.jar, "/Absent/My");
    // The page ships its summary table empty and loads it with this POST.
    const id = absenceStudentId(page.html);
    const summary = id ? await post(s.jar, "/Absent/SumarizedData", { StudentID: id }) : { html: "", changed: false };
    return { value: { page: page.html, summary: summary.html }, changed: page.changed || summary.changed };
  });
  return c.json(parseAbsence(page, summary));
});

/** Project elections: the student's choices and every project of one election (the newest by default), plus the
 * groups, blocks and class from the stored profile. */
app.get("/projects", async (c) => {
  const wanted = c.req.query("election");
  type Pages = { elections: { id: string; label: string }[]; election: { id: string; label: string } | null; detail: string; mine: string };
  const sis = await withSis<Pages>(c, async (s) => {
    const page = await get(s.jar, "/Election/Project");
    const elections = parseElections(page.html);
    const election = elections.find((e) => e.id === wanted) ?? elections[0];
    if (!election) return { value: { elections, election: null, detail: "", mine: "" }, changed: page.changed };
    const detail = await post(s.jar, "/Election/ProjectDetail", { id: election.id });
    const mine = await post(s.jar, "/Election/ProjectElected", { ElectionID: election.id });
    return { value: { elections, election, detail: detail.html, mine: mine.html }, changed: page.changed || detail.changed || mine.changed };
  });
  const row = await c.env.DB.prepare("SELECT email, groups, blocks, class FROM users WHERE id = ?")
    .bind(c.get("session").userId)
    .first<{ email: string | null; groups: string | null; blocks: string | null; class: string | null }>();
  return c.json({
    elections: sis.elections,
    election: sis.election,
    mine: parseProjectChoices(sis.mine),
    projects: parseProjects(sis.detail),
    profile: {
      class: row?.class ?? null,
      email: row?.email ?? null,
      groups: JSON.parse(row?.groups ?? "[]") as string[],
      blocks: JSON.parse(row?.blocks ?? "[]") as { subject: string; block: string }[],
    },
  });
});

app.post("/push/subscribe", async (c) => {
  const { subscription } = await c.req.json<{ subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }>();
  const endpoint = subscription?.endpoint;
  const { p256dh, auth } = subscription?.keys ?? {};
  const key = (k: unknown, max: number) => typeof k === "string" && k.length > 0 && k.length <= max;
  if (typeof endpoint !== "string" || !isPushEndpoint(endpoint) || !key(p256dh, 200) || !key(auth, 100))
    return c.json({ error: "bad_subscription" }, 400);
  const userId = c.get("session").userId;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, user_id, created, p256dh, auth) VALUES (?, ?, ?, ?, ?)").bind(
      endpoint,
      userId,
      Date.now(),
      p256dh,
      auth,
    ),
    // Keeps the newest few devices, so one account can't fill the database.
    c.env.DB.prepare(
      `DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint NOT IN
       (SELECT endpoint FROM push_subscriptions WHERE user_id = ?1 ORDER BY created DESC LIMIT ?2)`,
    ).bind(userId, MAX_PUSH_DEVICES),
  ]);
  return c.json({ ok: true });
});

app.post("/push/unsubscribe", async (c) => {
  const { endpoint } = await c.req.json<{ endpoint?: string }>();
  if (endpoint)
    await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
      .bind(endpoint, c.get("session").userId)
      .run();
  return c.json({ ok: true });
});

app.post("/push/test", async (c) => {
  if (await overLimit(c.env.LOGIN_USER_LIMIT, `push:${c.get("session").userId}`)) return c.json({ error: "rate_limited" }, 429);
  const subs = await c.env.DB.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ?")
    .bind(c.get("session").userId)
    .all<{ endpoint: string }>();
  const valid = subs.results.filter((s) => isPushEndpoint(s.endpoint));
  await notifyAll(c.env, valid);
  return c.json({ sent: valid.length });
});

// ---------- bug reports ----------

const REPORT_MAX = 2000;

/** A bug report or an idea from Settings, posted to the developer's Telegram as plain text (no markup to inject). */
app.post("/report", async (c) => {
  if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.TELEGRAM_CHAT_ID) return c.json({ error: "not_configured" }, 503);
  const { userId } = c.get("session");
  if (await overLimit(c.env.LOGIN_USER_LIMIT, `report:${userId}`)) return c.json({ error: "rate_limited" }, 429);
  const body = await c.req.json<{ kind?: string; text?: string; meta?: Record<string, unknown> }>().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > REPORT_MAX) return c.json({ error: "bad_text" }, 400);
  const kind = body?.kind === "idea" ? "Nápad" : "Chyba";
  // Short, known fields only: whatever else the client sends doesn't end up in the chat.
  const meta = body?.meta ?? {};
  const field = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string).slice(0, 200) : "?");
  const who = await c.env.DB.prepare("SELECT name, class FROM users WHERE id = ?").bind(userId).first<{ name: string | null; class: string | null }>();
  const message = [
    `${kind} · ${who?.name ?? "?"}${who?.class ? ` (${who.class})` : ""}`,
    "",
    text,
    "",
    `verze ${field("version")} · ${field("screen")} · ${field("layout")} · ${field("display")}`,
    field("device"),
  ].join("\n");
  const res = await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: c.env.TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: true }),
  });
  if (!res.ok) {
    console.error("telegram", res.status, await res.text().catch(() => ""));
    return c.json({ error: "upstream" }, 502);
  }
  return c.json({ ok: true });
});

// ---------- profile & notifications ----------

async function saveProfile(db: D1Database, s: Session) {
  const { html } = await get(s.jar, "/Account/UserProfile");
  const p = parseProfile(html);
  const photo = await getBinary(s.jar, "/Account/Photo.jpg").catch(() => null);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, name, photo, photo_type, first_seen, last_seen, email, groups, blocks, projects)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(id) DO UPDATE SET name = ?2, photo = COALESCE(?3, photo), photo_type = COALESCE(?4, photo_type), last_seen = ?5,
         email = COALESCE(?6, email), groups = ?7, blocks = ?8, projects = ?9`,
    )
    .bind(
      s.userId,
      p.name ?? s.cred.u,
      photo?.body ?? null,
      photo?.type ?? null,
      now,
      p.email,
      JSON.stringify(p.groups),
      JSON.stringify(p.blocks),
      JSON.stringify(p.projects),
    )
    .run();
}

async function notifyAll(env: Bindings, subs: { endpoint: string }[]) {
  const keys = { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: env.VAPID_PRIVATE_JWK };
  const gone: string[] = [];
  await Promise.all(subs.map(async ({ endpoint }) => (await sendPush(endpoint, keys)) || gone.push(endpoint)));
  if (gone.length)
    await env.DB.batch(gone.map((e) => env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(e)));
}

/** Cron: cheap check whether SIS rewrote any remaining day. True when it did. */
async function checkSchoolImages(env: Bindings) {
  const prague = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());
  const weeks = await schoolWeeks();
  const files = weeks.flatMap((w) =>
    ["PO", "UT", "ST", "CT", "PA"]
      .map((d, i) => ({ file: `${d}${w.week}`, date: addDays(w.start, i) }))
      .filter((f) => f.date >= prague),
  );
  const stored = new Map(
    (await env.DB.prepare("SELECT file, hash FROM school_images").all<{ file: string; hash: string }>()).results.map((r) => [
      r.file,
      r.hash,
    ]),
  );
  const now = Date.now();
  let changed = false;
  const writes: D1PreparedStatement[] = [];
  for (const { file } of files) {
    const res = await fetchSchoolImage(file);
    if (!res.ok) continue;
    const hash = await sha256(await res.arrayBuffer());
    if (stored.has(file) && stored.get(file) !== hash) changed = true;
    writes.push(env.DB.prepare("INSERT OR REPLACE INTO school_images (file, hash, checked) VALUES (?, ?, ?)").bind(file, hash, now));
  }
  if (writes.length) await env.DB.batch(writes);
  return changed;
}

/**
 * Wakes the GitHub Action (watch.yml). GitHub's own schedule for it is throttled to a run every few hours, a
 * repository_dispatch starts within seconds, so this cron is the Action's real clock.
 */
async function dispatchWatch(env: Bindings, event: "school-changed" | "tick") {
  if (!env.GITHUB_TOKEN) return;
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "OpenSISAKHK",
    },
    body: JSON.stringify({ event_type: event }),
  });
  if (!res.ok) console.error("dispatch failed", res.status, await res.text());
}

async function cron(env: Bindings, scheduledTime: number) {
  const changed = await checkSchoolImages(env).catch((e) => (console.error("school images", e), false));
  if (changed) await dispatchWatch(env, "school-changed");
  else if (isTick(scheduledTime)) await dispatchWatch(env, "tick");
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(cron(env, event.scheduledTime));
  },
} satisfies ExportedHandler<Bindings>;
