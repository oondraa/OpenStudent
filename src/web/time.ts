export const WEEKDAYS = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"];
const MONTHS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];

// Built once: a DateTimeFormat is costly to create, and these run on every render.
const DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" });
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const todayPrague = () => DATE.format(new Date());

/** Dev only: a pretend time of day (`?cas=9:45`, main.tsx), to try school-day screens in the evening. */
function devTime() {
  if (!import.meta.env.DEV) return null;
  const v = localStorage.getItem("osis:devCas")?.match(/^(\d{1,2}):(\d{2})$/);
  return v ? Number(v[1]) * 60 + Number(v[2]) : null;
}

export function nowMinutesPrague() {
  const fake = devTime();
  if (fake !== null) return fake;
  const [h, m] = TIME
    .format(new Date())
    .split(":")
    .map(Number);
  return h * 60 + m;
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

/** 0 = Monday … 6 = Sunday */
export const weekdayIndex = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

/** School day to show by default: today on weekdays, next Monday on weekends. */
export function defaultSchoolDay() {
  const t = todayPrague();
  const wd = weekdayIndex(t);
  return wd < 5 ? t : addDays(t, 7 - wd);
}

/** The weekday after `iso` (Friday → Monday). */
export function nextSchoolDay(iso: string) {
  const wd = weekdayIndex(iso);
  return addDays(iso, wd >= 4 ? 7 - wd : 1);
}

export const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export function longDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[weekdayIndex(iso)]} ${d}. ${MONTHS[m - 1]}`;
}

export function inMinutes(n: number) {
  if (n < 1) return "teď";
  if (n < 60) return `za ${n} min`;
  const h = Math.floor(n / 60);
  return `za ${h} h ${n % 60 ? `${n % 60} min` : ""}`.trim();
}
