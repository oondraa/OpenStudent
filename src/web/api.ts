import type { Cell, Day, SchoolInfo } from "../shared/types";
import type { LunchDay, Menu } from "../worker/strava";
import type { Crowd } from "../worker/menza";
import type { TestItem, TestKind } from "../shared/tests";

export type TimetableDay = Day;
export interface TimetableResponse {
  week: string;
  days: TimetableDay[];
  /** "no_class": school or class not chosen yet; "no_data": the school's timetable isn't uploaded yet */
  error?: "no_class" | "no_data";
  /** when the pipeline last read the school's timetable */
  fetched?: string;
  /** Mondays the server has (this and next week) */
  weeks?: string[];
}
export interface SchoolWeekResponse {
  week: string;
  periods: [string, string][];
  /** Monday … Friday, every lesson of the whole school */
  days: Cell[][];
}

export interface LunchResponse {
  connected: boolean;
  days: LunchDay[];
  error?: string;
}

/** The class's tests from today on (the Testy screen). */
export interface UpcomingTests {
  /** null = class not confirmed yet: no tests to show or add. */
  class: string | null;
  tests: TestItem[];
}
/** The class's tests in one week (the timetable). */
export type TestsResponse = UpcomingTests & { week: string };

export class Unauthorized extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (res.status === 401) throw new Unauthorized(body.error);
  if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  /** Sends a 6-digit code to the e-mail. `dev` = the code itself, only in local development. */
  authStart: (email: string) =>
    call<{ ok: true; dev?: string }>("/auth/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }),
  authVerify: (email: string, code: string) =>
    call<{ ok: true }>("/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code }) }),
  logout: () => call<{ ok: true }>("/logout", { method: "POST" }),
  deleteAccount: () => call<{ ok: true }>("/me/delete", { method: "POST" }),
  schools: () => call<{ schools: SchoolInfo[] }>("/schools"),
  /** When every class in the city finishes on `date` (Kdo kdy končí). */
  ends: (date: string) =>
    call<{ date: string; dates: string[]; schools: { school: string; size: number; classes: Record<string, string> }[] }>(`/ends?date=${date}`),
  classGroups: (school: string, cls: string) => call<{ groups: string[] }>(`/schools/${encodeURIComponent(school)}/groups?class=${encodeURIComponent(cls)}`),
  setProfile: (p: { school?: string; cls?: string | null; groups?: string[]; name?: string }) => post("/me/profile", p),
  timetable: (week?: string) => call<TimetableResponse>(`/timetable${week ? `?week=${week}` : ""}`),
  /** Permanent timetable (no substitutions) of the week starting `week`: the school's regular pattern. */
  permanentTimetable: (week: string) => call<TimetableResponse>(`/timetable?week=${week}&static=1`),
  /** The whole school's week (free rooms, teachers). */
  schoolWeek: (week?: string) => call<SchoolWeekResponse>(`/school/week${week ? `?week=${week}` : ""}`),
  tests: (week: string) => call<TestsResponse>(`/tests?week=${week}`),
  upcomingTests: () => call<UpcomingTests>("/tests/upcoming"),
  addTest: (t: { date: string; start: string; subject: string; group: string; kind: TestKind; note: string }) =>
    call<UpcomingTests>("/tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t) }),
  deleteTest: (id: number) => call<UpcomingTests>(`/tests/${id}/delete`, { method: "POST" }),
  flagTest: (id: number, on: boolean) =>
    call<UpcomingTests>(`/tests/${id}/flag`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) }),
  /** SideQuesty: delays (minutes) of the regional buses and trains running now, by IREDO id. */
  liveIredo: () => call<{ delays: Record<string, number> }>("/live/iredo"),
  /** SideQuesty: live departures from the city transport stop at a place (delay in seconds). */
  liveMhd: (lat: number, lon: number) => call<{ departures: { line: string; plan: number; delay: number }[] }>(`/live/mhd?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`),
  me: () => call<Me>("/me"),
  lunch: () => call<LunchResponse>("/lunch"),
  canteen: () => call<CanteenResponse>("/canteen"),
  /** Canteen crowd forecast (from timetables, not a live count). */
  canteenCrowd: () => call<Crowd>("/canteen/crowd"),
  order: (date: string, veta: string | null) =>
    call<CanteenResponse>("/canteen/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, veta }) }),
  stravaConnect: (jmeno: string, heslo: string) => post("/strava", { jmeno, heslo }),
  stravaDisconnect: () => post("/strava/disconnect", {}),
  pushKey: () => call<{ key: string }>("/push/key"),
  pushSubscribe: (subscription: PushSubscriptionJSON) => post("/push/subscribe", { subscription }),
  pushUnsubscribe: (endpoint: string) => post("/push/unsubscribe", { endpoint }),
  pushTest: () => call<{ sent: number }>("/push/test", { method: "POST" }),
  report: (kind: "bug" | "idea", text: string, meta: Record<string, string>) => post("/report", { kind, text, meta }),
};

export type CanteenResponse = Menu & { connected: boolean; canteen: SchoolInfo["canteen"]; error?: string };

export interface Me {
  email: string;
  /** optional nickname, shown next to tests the student adds */
  name: string | null;
  school: SchoolInfo | null;
  /** null = not chosen yet (SchoolPrompt asks) */
  class: string | null;
  groups: string[];
  pushDevices: number;
  strava: boolean;
}

function post(path: string, body: unknown) {
  return call<{ ok: true }>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

// Last successful responses, so the app opens instantly and works offline.
export const cache = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(`ost:${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  /** false when the stored value was already the same (nothing written). */
  set(key: string, value: unknown) {
    try {
      const raw = JSON.stringify(value);
      if (localStorage.getItem(`ost:${key}`) === raw) return false;
      localStorage.setItem(`ost:${key}`, raw);
    } catch {
      /* storage full or blocked */
    }
    return true;
  },
  clear() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("ost:"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  },
};
