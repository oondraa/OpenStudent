// Timetable change notifications. The school's timetable is public, so unlike OpenSISAKHK nobody has to be logged in
// for the server to notice a change: when the pipeline uploads a school's new timetable, every class (this and next
// week, from today on) is compared with the last upload and its students get "Út 10. 11.: 8:00 ČJ · 105, 8:55 odpadá".
// Only classes somebody subscribed for are looked at; the first upload of a week just remembers it.

import { addDays, inGroups, type RawLesson, type SchoolTimetable } from "./data";
import { sendPush, type VapidKeys } from "./push";

interface NotifyEnv {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string;
}

const DAYS = ["Po", "Út", "St", "Čt", "Pá"];
const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const pragueToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());

/** date → "start|group" → description of the lesson (what students would notice changing). */
type Snapshot = Record<string, Record<string, string>>;

function snapshot(days: { date: string | null; off: boolean; lessons: RawLesson[] }[], week: string, today: string): Snapshot {
  const out: Snapshot = {};
  days.slice(0, 5).forEach((d, i) => {
    const date = d.date ?? addDays(week, i);
    if (date < today) return;
    const slots: Record<string, string> = {};
    for (const l of d.off ? [] : d.lessons) if (l.change !== "cancel") slots[`${l.s}|${l.group}`] = [l.subj, l.room, l.teacher].join(" · ");
    out[date] = slots;
  });
  return out;
}

async function hash(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf, 0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Change {
  date: string;
  start: number;
  group: string;
  now: string | null;
}

function diff(before: Snapshot, after: Snapshot): Change[] {
  const out: Change[] = [];
  for (const [date, slots] of Object.entries(after)) {
    const old = before[date];
    if (!old) continue;
    for (const [k, v] of Object.entries(slots)) if (old[k] !== v) out.push({ date, start: Number(k.split("|")[0]), group: k.split("|")[1], now: v });
    for (const k of Object.keys(old)) if (!(k in slots)) out.push({ date, start: Number(k.split("|")[0]), group: k.split("|")[1], now: null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

/** "Út 10. 11.: 8:00 ČJ · 105, 8:55 odpadá" (one line per day, at most three days). */
export function describe(changes: Change[]) {
  const byDay = new Map<string, Change[]>();
  for (const c of changes) byDay.set(c.date, [...(byDay.get(c.date) ?? []), c]);
  const lines = [...byDay].slice(0, 3).map(([date, cs]) => {
    const d = new Date(`${date}T00:00:00Z`);
    const head = `${DAYS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`;
    return `${head}: ${cs.map((c) => `${fmt(c.start)} ${c.now ?? "odpadá"}`).join(", ")}`;
  });
  if (byDay.size > 3) lines.push(`… a další ${byDay.size - 3} dny`);
  return lines.join("\n");
}

export async function notifyChanges(env: NotifyEnv, tt: SchoolTimetable) {
  const today = pragueToday();
  const subs = await env.DB.prepare(
    `SELECT u.class, u.groups, s.endpoint, s.p256dh, s.auth FROM users u JOIN push_subscriptions s ON s.user_id = u.id
     WHERE u.school = ? AND u.class IS NOT NULL`,
  )
    .bind(tt.school)
    .all<{ class: string; groups: string; endpoint: string; p256dh: string | null; auth: string | null }>();
  const classes = new Set(subs.results.map((r) => r.class));
  const writes: D1PreparedStatement[] = [];
  const changed = new Map<string, Change[]>();
  for (const [week, byClass] of Object.entries(tt.weeks)) {
    if (addDays(week, 4) < today) continue;
    for (const cls of classes) {
      const days = byClass[cls];
      if (!days) continue;
      const snap = snapshot(days, week, today);
      const h = await hash(JSON.stringify(snap));
      const prev = await env.DB.prepare("SELECT hash, lessons FROM class_seen WHERE school = ? AND class = ? AND week = ?")
        .bind(tt.school, cls, week)
        .first<{ hash: string; lessons: string }>();
      if (prev?.hash === h) continue;
      writes.push(
        env.DB.prepare("INSERT OR REPLACE INTO class_seen (school, class, week, hash, lessons) VALUES (?, ?, ?, ?, ?)").bind(tt.school, cls, week, h, JSON.stringify(snap)),
      );
      if (prev) changed.set(cls, [...(changed.get(cls) ?? []), ...diff(JSON.parse(prev.lessons), snap)]);
    }
  }
  if (writes.length) await env.DB.batch(writes);
  const keys: VapidKeys = { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: env.VAPID_PRIVATE_JWK };
  const gone: string[] = [];
  for (const r of subs.results) {
    const groups = JSON.parse(r.groups) as string[];
    const mine = (changed.get(r.class) ?? []).filter((c) => inGroups(c.group, groups));
    if (!mine.length) continue;
    const payload = { title: `Změna rozvrhu · ${r.class}`, body: describe(mine), tag: `tt-${tt.school}-${r.class}`, url: "/?tab=timetable" };
    if (!(await sendPush(r, keys, payload))) gone.push(r.endpoint);
  }
  if (gone.length) await env.DB.batch(gone.map((e) => env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(e)));
}
