import { readSchoolDay, type Cell } from "../shared/schoolOcr";
import { weekdayIndex } from "./time";

export const DAY_CODES = ["PO", "UT", "ST", "CT", "PA"];

export type SchoolWeeks = { weeks: { start: string; end: string; week: number }[] };

/** Public image name for a school day ("ST1"), null when the school doesn't publish that week. */
export function schoolFile(weeks: SchoolWeeks | null | undefined, iso: string) {
  const week = weeks?.weeks.find((w) => w.start <= iso && iso <= w.end);
  return week && weekdayIndex(iso) < 5 ? `${DAY_CODES[weekdayIndex(iso)]}${week.week}` : null;
}

/** Downloads one school-wide timetable image and reads it, right here on the phone. */
export async function readSchoolFile(file: string): Promise<Cell[]> {
  const bmp = await createImageBitmap(await (await fetch(`/api/school/${file}.jpg`)).blob());
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return readSchoolDay(ctx.getImageData(0, 0, bmp.width, bmp.height));
}
