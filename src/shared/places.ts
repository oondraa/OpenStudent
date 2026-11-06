// Places for SideQuesty (public/data/places.json, scripts/places.ts) and their OpenStreetMap opening hours.

/** [name, kind (OSM shop/amenity/leisure value), lat, lon, opening_hours or null] */
export type Place = [string, string, number, number, string | null];

export interface PlacesData {
  generated: string;
  source: string;
  places: Place[];
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Open intervals in minutes for each weekday (Monday = 0); an interval past midnight ends after 1440. */
export type Week = [number, number][][];

/**
 * The common forms of the OSM `opening_hours` tag: "24/7", "Mo-Fr 08:00-18:00; Sa 08:00-12:00",
 * "Mo-Su 07:00-22:00", "Mo,We 09:00-12:00,13:00-17:00", "Su off", times with no days (every day).
 * A later rule replaces the earlier ones for the days it names, as in OSM. Holidays (PH, SH) are skipped.
 * Anything else (months, weeks, sunset…): null, the hours are shown as unknown rather than guessed.
 */
export function parseHours(tag: string | null): Week | null {
  if (!tag) return null;
  // Some places separate the rules with commas ("Mo-Th 10:30-23:00, Fr 10:30-01:00"): after a time, a comma before
  // a day is a new rule.
  const s = tag.trim().replace(/(\d{2}:\d{2})\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/g, "$1; ");
  if (s === "24/7") return DAYS.map(() => [[0, 1440]]);
  const week: Week = DAYS.map(() => []);
  for (const raw of s.split(";")) {
    const rule = raw.trim();
    if (!rule) continue;
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/);
    if (!m) return null;
    const [, dayPart, timePart] = m;
    let days: number[] = DAYS.map((_, i) => i);
    if (dayPart) {
      days = [];
      let onlyHolidays = true;
      for (const d of dayPart.split(",").map((x) => x.trim())) {
        if (d === "PH" || d === "SH") continue;
        onlyHolidays = false;
        const [a, b] = d.split("-").map((x) => DAYS.indexOf(x));
        if (b === undefined) days.push(a);
        else for (let i = a; ; i = (i + 1) % 7) {
          days.push(i);
          if (i === b) break;
        }
      }
      if (onlyHolidays) continue;
    }
    const time = timePart.trim();
    if (time === "off" || time === "closed") {
      for (const d of days) week[d] = [];
      continue;
    }
    const spans: [number, number][] = [];
    for (const t of time.split(",").map((x) => x.trim())) {
      const tm = t.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/);
      if (!tm) return null;
      const from = Number(tm[1]) * 60 + Number(tm[2]);
      let to = Number(tm[3]) * 60 + Number(tm[4]);
      if (to <= from) to += 1440;
      spans.push([from, to]);
    }
    for (const d of days) week[d] = spans;
  }
  return week;
}

export type OpenState =
  /** Open at `at`, until `closes` (minutes, may be past 1440). */
  | { open: true; closes: number }
  /** Closed at `at`; opens at `opens` today, or null when not any more today. */
  | { open: false; opens: number | null };

/** Whether the place is open at minute `at` of weekday `day` (Monday = 0). */
export function openAt(week: Week, day: number, at: number): OpenState {
  // Last night's interval running past midnight.
  for (const [, to] of week[(day + 6) % 7]) if (to > 1440 && at < to - 1440) return { open: true, closes: to - 1440 };
  for (const [from, to] of week[day]) if (from <= at && at < to) return { open: true, closes: to };
  const later = week[day].filter(([from]) => from > at).map(([from]) => from);
  return { open: false, opens: later.length ? Math.min(...later) : null };
}

/** Czech label of a place's kind, for the most common ones; otherwise the OSM word. */
export const KIND_LABELS: Record<string, string> = {
  mall: "Obchodní centrum",
  supermarket: "Supermarket",
  convenience: "Večerka",
  department_store: "Obchodní dům",
  clothes: "Oblečení",
  shoes: "Obuv",
  electronics: "Elektronika",
  mobile_phone: "Mobily",
  computer: "Počítače",
  books: "Knihy",
  sports: "Sport",
  bakery: "Pekárna",
  pastry: "Cukrárna",
  butcher: "Řeznictví",
  chemist: "Drogerie",
  cosmetics: "Kosmetika",
  hairdresser: "Kadeřnictví",
  beauty: "Salon krásy",
  optician: "Optika",
  florist: "Květiny",
  gift: "Dárky",
  toys: "Hračky",
  jewelry: "Šperky",
  bicycle: "Kola",
  car: "Auta",
  car_repair: "Autoservis",
  car_parts: "Autodíly",
  hardware: "Železářství",
  doityourself: "Hobbymarket",
  furniture: "Nábytek",
  pet: "Chovatelské potřeby",
  alcohol: "Alkohol",
  beverages: "Nápoje",
  tobacco: "Trafika",
  newsagent: "Trafika",
  kiosk: "Stánek",
  stationery: "Papírnictví",
  second_hand: "Second hand",
  variety_store: "Smíšené zboží",
  greengrocer: "Zelenina",
  deli: "Lahůdky",
  tea: "Čaj",
  coffee: "Káva",
  games: "Hry",
  video_games: "Videohry",
  music: "Hudba",
  musical_instrument: "Hudební nástroje",
  outdoor: "Outdoor",
  bag: "Tašky",
  fabric: "Látky",
  copyshop: "Copy centrum",
  travel_agency: "Cestovka",
  cinema: "Kino",
  cafe: "Kavárna",
  fast_food: "Rychlé občerstvení",
  pub: "Hospoda",
  custom: "Vlastní místo",
  restaurant: "Restaurace",
  bar: "Bar",
  biergarten: "Pivní zahrádka",
  ice_cream: "Zmrzlina",
  library: "Knihovna",
  marketplace: "Tržnice",
  sports_centre: "Sportovní centrum",
  swimming_pool: "Bazén",
  fitness_centre: "Fitness",
  bowling_alley: "Bowling",
};

export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind.replace(/_/g, " ");

/** What students call places, beyond their names and kinds: "vietnamci" are the corner shops, "OC" the malls. */
const NICKNAMES: [string, string[]][] = [
  ["viet", ["convenience"]],
  ["večerk", ["convenience"]],
  ["potravin", ["convenience", "supermarket"]],
  ["oc", ["mall", "department_store"]],
  ["obchoďák", ["mall", "department_store"]],
  ["obchodák", ["mall", "department_store"]],
  ["kafe", ["cafe"]],
  ["hosp", ["pub", "restaurant", "biergarten"]],
  ["pivo", ["pub", "bar", "biergarten"]],
  ["restaura", ["restaurant"]],
  ["kavárn", ["cafe"]],
  ["jídlo", ["fast_food"]],
  ["fastfood", ["fast_food"]],
  ["gym", ["fitness_centre"]],
  ["posilovn", ["fitness_centre"]],
];

/** Does a place match a search (lower-cased query): by name, by kind, or by a nickname of its kind. */
export function matchesPlace(p: Place, q: string) {
  if (p[0].toLocaleLowerCase("cs").includes(q) || kindLabel(p[1]).toLocaleLowerCase("cs").includes(q)) return true;
  return NICKNAMES.some(([nick, kinds]) => (q.startsWith(nick) || nick.startsWith(q)) && q.length >= 2 && kinds.includes(p[1]));
}
