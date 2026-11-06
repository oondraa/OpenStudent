// Strava.cz (school canteen orders). No official API: this is the JSON API behind app.strava.cz,
// read off its web app. Shape captured with scripts/strava-probe.ts.

const STRAVA = "https://app.strava.cz/api";
/** Jídelna SŠ a VOŠ aplikované kybernetiky. */
export const CANTEEN = "0288";

export interface StravaCred {
  cislo: string;
  jmeno: string;
  heslo: string;
}

export interface LunchDay {
  date: string; // YYYY-MM-DD
  /** The ordered meal, or null when nothing is ordered for that day. */
  ordered: { label: string; number: number | null; name: string } | null;
}

export interface Meal {
  veta: string;
  number: number | null;
  label: string;
  name: string;
  price: number;
  ordered: boolean;
  /** can be ordered, changed or cancelled right now */
  editable: boolean;
  allergens: string[];
}

export interface MenuDay {
  date: string; // YYYY-MM-DD
  soup: string | null;
  meals: Meal[];
  /** the canteen doesn't cook that day: the reason, e.g. "Prázdniny podzimní" */
  closed: string | null;
  /** ordering deadline in Prague local time, "2026-10-13T12:00:00" */
  deadline: string | null;
}

export interface Menu {
  /** the canteen account balance in Kč, as Strava shows it */
  balance: number | null;
  days: MenuDay[];
}

export class StravaBadCredentials extends Error {}
/** The order wasn't changed: the day is locked, the meal unknown, or Strava didn't end up in the wanted state. */
export class StravaOrderRefused extends Error {}

// A JSON body *without* a content-type header, like the web app: with application/json the API answers 555.
async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${STRAVA}/${path}`, { method: "POST", body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as (T & { state?: string; number?: number | string; message?: string }) | null;
  if (json === null) throw new Error(`Strava ${path} returned ${res.status}`);
  if (json && json.state === "error") {
    if (path === "login" && json.number === 20) throw new StravaBadCredentials();
    throw new Error(`Strava ${path}: ${json.message ?? json.number}`);
  }
  return json;
}

interface Item {
  datum: string; // "12.10.2026"
  druh: string; // "PO" soup, "O1", "O2", …
  druh_popis: string; // "Oběd 2"
  nazev: string;
  pocet: number;
  veta: string; // the item's id when ordering
  cena: string; // "49.00"
  alergeny?: [string, string][];
  /** Restrictions, "" = allowed: `obj` ordering, `zm` changing ("V" = not cooking, "C" = past the deadline, …) */
  omezeniObj?: { den: string; obj: string; zm: string; bur: string };
  casKonec?: string; // ordering deadline, Prague local time
}

const iso = (d: string) => {
  const [day, m, y] = d.split(".");
  return `${y}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`;
};
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** Now in Prague as "YYYY-MM-DDTHH:mm:ss", comparable with Strava's local deadlines. */
const pragueNow = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague", dateStyle: "short", timeStyle: "medium" }).format(new Date()).replace(" ", "T");

/** `/api/objednavky` → one entry per day: `{ table0: [items of 12. 10.], table1: [...] }`. */
export function parseOrders(orders: Record<string, Item[]>): LunchDay[] {
  return Object.values(orders)
    .filter((items) => Array.isArray(items) && items.length)
    .map((items) => {
      const meal = items.find((i) => i.pocet > 0 && i.druh !== "PO");
      return {
        date: iso(items[0].datum),
        ordered: meal
          ? { label: meal.druh_popis, number: Number(meal.druh.match(/\d+/)?.[0]) || null, name: clean(meal.nazev) }
          : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The same response as the whole menu: every meal of every day, which one is ordered and what can still change. */
export function parseMenu(orders: Record<string, Item[]>, now = pragueNow()): MenuDay[] {
  return Object.values(orders)
    .filter((items) => Array.isArray(items) && items.length)
    .map((items) => {
      const soup = items.find((i) => i.druh === "PO");
      const meals = items.filter((i) => i.druh !== "PO");
      const notCooking = meals.length > 0 && meals.every((i) => i.omezeniObj?.obj.includes("V"));
      return {
        date: iso(items[0].datum),
        soup: soup ? clean(soup.nazev) : null,
        closed: notCooking ? clean(meals[0].nazev).replace(/^nevaří se\s*-\s*/i, "") : null,
        deadline: meals[0]?.casKonec ?? null,
        meals: notCooking
          ? []
          : meals.map((i) => ({
              veta: i.veta,
              number: Number(i.druh.match(/\d+/)?.[0]) || null,
              label: i.druh_popis,
              name: clean(i.nazev),
              price: Number(i.cena) || 0,
              ordered: i.pocet > 0,
              editable: !!i.omezeniObj && i.omezeniObj.obj === "" && i.omezeniObj.zm === "" && !!i.casKonec && now < i.casKonec,
              allergens: (i.alergeny ?? []).map(([, name]) => name),
            })),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

type Session = { sid: string; s5url: string; ignoreCert: unknown; uzivatel?: { konto?: string } };

async function login(cred: StravaCred) {
  return call<Session>("login", {
    ...cred,
    zustatPrihlasen: false,
    environment: "W",
    lang: "CZ",
  });
}

async function logout(cred: StravaCred, s: Session) {
  await call("logOut", { sid: s.sid, cislo: cred.cislo, url: s.s5url, lang: "CZ", ignoreCert: s.ignoreCert }).catch(() => {});
}

/** Logs in, runs `fn` and always logs out again: Strava sessions are never kept. */
async function withStrava<T>(cred: StravaCred, fn: (s: Session) => Promise<T>): Promise<T> {
  const s = await login(cred);
  try {
    return await fn(s);
  } finally {
    await logout(cred, s);
  }
}

const readOrders = (cred: StravaCred, s: Session) =>
  call<Record<string, Item[]>>("objednavky", { cislo: cred.cislo, sid: s.sid, s5url: s.s5url, lang: "CZ", konto: 0, podminka: "", ignoreCert: s.ignoreCert });

const money = (v: string | undefined) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Throws StravaBadCredentials on a wrong name/password. */
export async function checkLogin(cred: StravaCred) {
  await withStrava(cred, async () => {});
}

/** Ordered lunches for the next weeks (Strava shows ~3), for the timetable's lunch card. */
export async function fetchLunches(cred: StravaCred): Promise<LunchDay[]> {
  return withStrava(cred, async (s) => parseOrders(await readOrders(cred, s)));
}

/** The whole menu with what's ordered, for the Obědy screen. */
export async function fetchMenu(cred: StravaCred): Promise<Menu> {
  return withStrava(cred, async (s) => ({ balance: money(s.uzivatel?.konto), days: parseMenu(await readOrders(cred, s)) }));
}

type Staged = { produkt?: { $: { Veta: string; Pocet: string } }[] };

/**
 * Orders `veta` for `date`, switching away from the meal ordered so far, or cancels the day with `veta` null.
 * Checked against a fresh read first; afterwards the menu is read again and has to show exactly the wanted state,
 * otherwise StravaOrderRefused. The same calls as the Strava web app: stage the change, then save.
 */
export async function changeOrder(cred: StravaCred, date: string, veta: string | null): Promise<Menu> {
  return withStrava(cred, async (s) => {
    const day = parseMenu(await readOrders(cred, s)).find((d) => d.date === date);
    if (!day) throw new StravaOrderRefused("unknown_day");
    const current = day.meals.find((m) => m.ordered) ?? null;
    const target = veta === null ? null : day.meals.find((m) => m.veta === veta);
    if (target === undefined) throw new StravaOrderRefused("unknown_meal");
    let balance = money(s.uzivatel?.konto);
    if ((current?.veta ?? null) !== (target?.veta ?? null)) {
      if ((current && !current.editable) || (target && !target.editable)) throw new StravaOrderRefused("locked");
      const base = { cislo: cred.cislo, sid: s.sid, url: s.s5url, lang: "CZ", ignoreCert: s.ignoreCert };
      const stage = (v: string, pocet: number) => call<Staged>("pridejJidloS5", { ...base, veta: v, pocet });
      const staged = target ? await stage(target.veta, 1) : null;
      // Strava usually swaps the meal by itself; when the old one is still on (or unknown), take it off explicitly.
      const oldStillOn = !staged?.produkt?.some((p) => p.$.Veta === current?.veta && Number(p.$.Pocet) === 0);
      if (current && oldStillOn) await stage(current.veta, 0);
      const saved = await call<{ konto?: string } | false>("saveOrders", { ...base, xml: null });
      if (saved === false) throw new StravaOrderRefused("not_saved");
      balance = money(saved.konto) ?? balance;
    }
    const days = parseMenu(await readOrders(cred, s));
    const now = days.find((d) => d.date === date)?.meals.find((m) => m.ordered)?.veta ?? null;
    if (now !== (target?.veta ?? null)) throw new StravaOrderRefused("not_applied");
    return { balance, days };
  });
}
