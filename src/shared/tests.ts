/** What students can mark on a lesson. */
export const TEST_KINDS = {
  test: "Test",
  zkouseni: "Zkoušení",
  odevzdani: "Odevzdání",
} as const;
export type TestKind = keyof typeof TEST_KINDS;

export const TEST_NOTE_MAX = 80;
/** Classmates' "To neplatí" that hide a test. */
export const TEST_FLAGS_HIDE = 3;
/** Tests one student can add in 24 hours. */
export const TEST_DAILY_MAX = 10;

/** A test as the app shows it. The Testy screen names who added it, the timetable doesn't. */
export interface TestItem {
  id: number;
  date: string;
  start: string;
  subject: string;
  group: string;
  kind: TestKind;
  note: string;
  /** Added by this student: they can delete it. */
  mine: boolean;
  /** The author's name as SIS has it. */
  by: string | null;
  /** This student said it doesn't hold. */
  flagged: boolean;
  /** Hidden by classmates' flags; only its author still sees it, marked. */
  hidden: boolean;
}

/** The lesson a test belongs to: the same slot in everyone's timetable of the class. */
export const sameLesson = (t: { date: string; start: string; subject: string; group: string }, date: string, l: { start: string; subject: string; group: string }) =>
  t.date === date && t.start === l.start && t.subject === l.subject && t.group === l.group;

/** The note as stored: one line, no control characters, at most TEST_NOTE_MAX characters. */
export function cleanNote(s: unknown) {
  if (typeof s !== "string") return "";
  return s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, TEST_NOTE_MAX);
}
