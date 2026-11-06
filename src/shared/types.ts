// Shapes shared by the Worker and the app. A lesson looks the same as in OpenSISAKHK, so its screens work unchanged;
// here it comes from the school's public timetable (Bakaláři, EduPage, KybernaIS) instead of a personal SIS one.

export interface Lesson {
  id: string | null;
  /** Short name as the school writes it ("ČJ", "MAT"). */
  subject: string;
  /** Full name when the school publishes one ("Český jazyk"). */
  subjectName?: string;
  start: string; // "8:00"
  end: string;
  room: string;
  group: string;
  /** The teacher's abbreviation from the public timetable. Full names are never stored. */
  teacher: string;
  changed: boolean;
  cancelled: boolean;
  added: boolean;
  meet: string | null;
}

export interface Day {
  date: string;
  /** "12. pondělí" */
  label: string;
  lessons: Lesson[];
  /** A break of at least 25 min around noon: when the class can go for lunch. */
  lunch: { start: string; end: string } | null;
}

/** A lesson of the whole school on one day, for free rooms and teachers (same as OpenSISAKHK's OCR cell). */
export interface Cell {
  cls: string;
  period: number;
  slot: number;
  subject: string;
  teacher: string;
  room: string;
  changed: boolean;
}

export interface SchoolInfo {
  id: string;
  name: string;
  /** Short name for the app ("ZŠ Sever"). */
  nick: string;
  level: "ZŠ" | "SŠ";
  system: string | null;
  lat: number | null;
  lon: number | null;
  logo: string | null;
  canteen: { id: string; strava: string | null; name: string } | null;
  walk: Record<string, number>;
  /** false = the school doesn't publish its timetable, the app can't show it. */
  supported: boolean;
  classes: string[];
  periods?: [string, string][];
  fetched?: string;
}
