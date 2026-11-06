import { SIS } from "./sis";

export const SCHOOL_FILES = ["PO", "UT", "ST", "CT", "PA"].flatMap((d) => [`${d}1`, `${d}2`]);

export interface SchoolWeek {
  start: string; // YYYY-MM-DD (Monday)
  end: string;
  week: 1 | 2;
}

const iso = (d: string) => {
  const [day, month, year] = d.split(".").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/** Reads which calendar weeks the public images 1/2 currently show. */
export async function schoolWeeks(): Promise<SchoolWeek[]> {
  // Cached like the images, so a burst of requests to /api/school/weeks doesn't become a burst at SIS.
  const html = await (await fetch(`${SIS}/TimeTable/School`, { cf: { cacheTtl: 120, cacheEverything: true } })).text();
  return [...html.matchAll(/Týden:\s*\((\d+\.\d+\.\d+)\s*-\s*(\d+\.\d+\.\d+)\)/g)].map((m, i) => ({
    start: iso(m[1]),
    end: iso(m[2]),
    week: (i + 1) as 1 | 2,
  }));
}

export async function fetchSchoolImage(file: string): Promise<Response> {
  return fetch(`${SIS}/TimeTable/${file}.jpg`, { cf: { cacheTtl: 120, cacheEverything: true } });
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Every 10 minutes from 6:00 to 22:30 in Prague, the times the grades and absences are worth checking. */
export function isTick(scheduledTime: number) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(scheduledTime))
    .split(":")
    .map(Number);
  const min = h * 60 + m;
  return min % 10 < 5 && min >= 6 * 60 && min <= 22 * 60 + 30;
}
