import type { Absence, Day, Finance, Project, ProjectChoice, Subject } from "../worker/parse";
import type { LunchDay, Menu } from "../worker/strava";
import type { Crowd } from "../worker/menza";
import type { TestItem, TestKind } from "../shared/tests";

export type TimetableDay = Day;
export interface TimetableResponse {
  week: string;
  days: TimetableDay[];
}
export interface GradesResponse {
  subjects: Subject[];
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
  login: (username: string, password: string) =>
    call<{ ok: true }>("/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  logout: () => call<{ ok: true }>("/logout", { method: "POST" }),
  timetable: (week?: string) => call<TimetableResponse>(`/timetable${week ? `?week=${week}` : ""}`),
  /** Permanent timetable (no substitutions or cancellations) of the week starting `week`. */
  permanentTimetable: (week: string) => call<TimetableResponse>(`/timetable?week=${week}&static=1`),
  tests: (week: string) => call<TestsResponse>(`/tests?week=${week}`),
  upcomingTests: () => call<UpcomingTests>("/tests/upcoming"),
  addTest: (t: { date: string; start: string; subject: string; group: string; kind: TestKind; note: string }) =>
    call<UpcomingTests>("/tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t) }),
  deleteTest: (id: number) => call<UpcomingTests>(`/tests/${id}/delete`, { method: "POST" }),
  flagTest: (id: number, on: boolean) =>
    call<UpcomingTests>(`/tests/${id}/flag`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) }),
  grades: () => call<GradesResponse>("/grades"),
  /** SideQuesty: delays (minutes) of the regional buses and trains running now, by IREDO id. */
  liveIredo: () => call<{ delays: Record<string, number> }>("/live/iredo"),
  /** SideQuesty: live departures from the city transport stop at a place (delay in seconds). */
  liveMhd: (lat: number, lon: number) => call<{ departures: { line: string; plan: number; delay: number }[] }>(`/live/mhd?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`),
  absence: () => call<Absence>("/absence"),
  me: () => call<Me>("/me"),
  setClass: (cls: string) => post("/me/class", { cls }),
  lunch: () => call<LunchResponse>("/lunch"),
  canteen: () => call<CanteenResponse>("/canteen"),
  /** Canteen crowd forecast from OpenŠtudent (from timetables, not a live count). */
  canteenCrowd: () => call<Crowd>("/canteen/crowd"),
  /** Orders `veta` for the day (switching from the ordered meal), or cancels the day with null. */
  order: (date: string, veta: string | null) =>
    call<CanteenResponse>("/canteen/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, veta }) }),
  finance: () => call<Finance>("/finance", { cache: "no-store" }),
  projects: (election?: string) => call<ProjectsResponse>(`/projects${election ? `?election=${election}` : ""}`),
  stravaConnect: (jmeno: string, heslo: string) => post("/strava", { jmeno, heslo }),
  stravaDisconnect: () => post("/strava/disconnect", {}),
  watch: (on: boolean) => post("/watch", { on }),
  schoolWeeks: () => call<{ weeks: { start: string; end: string; week: 1 | 2 }[] }>("/school/weeks"),
  pushKey: () => call<{ key: string }>("/push/key"),
  pushSubscribe: (subscription: PushSubscriptionJSON) => post("/push/subscribe", { subscription }),
  pushUnsubscribe: (endpoint: string) => post("/push/unsubscribe", { endpoint }),
  pushTest: () => call<{ sent: number }>("/push/test", { method: "POST" }),
  /** Bug report or idea, sent to the developer's Telegram. */
  report: (kind: "bug" | "idea", text: string, meta: Record<string, string>) => post("/report", { kind, text, meta }),
};

export interface ProjectsResponse {
  elections: { id: string; label: string }[];
  election: { id: string; label: string } | null;
  mine: ProjectChoice[];
  projects: Project[];
  profile: { class: string | null; email: string | null; groups: string[]; blocks: { subject: string; block: string }[] };
}

export type CanteenResponse = Menu & { connected: boolean; error?: string };

export interface Me {
  name: string | null;
  hasPhoto: boolean;
  /** null = not confirmed yet (SIS doesn't show the class, ClassPrompt asks) */
  class: string | null;
  pushDevices: number;
  watching: boolean;
  strava: boolean;
}

function post(path: string, body: unknown) {
  return call<{ ok: true }>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

// Last successful responses, so the app opens instantly and works offline.
export const cache = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(`osis:${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  /** false when the stored value was already the same (nothing written). */
  set(key: string, value: unknown) {
    try {
      const raw = JSON.stringify(value);
      if (localStorage.getItem(`osis:${key}`) === raw) return false;
      localStorage.setItem(`osis:${key}`, raw);
    } catch {
      /* storage full or blocked */
    }
    return true;
  },
  clear() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("osis:"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  },
};
