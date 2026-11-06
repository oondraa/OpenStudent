import { createContext, memo, useContext, type ReactNode, type Ref } from "react";
import { api, cache, type CanteenResponse, type TimetableResponse, type UpcomingTests } from "./api";
import { TEST_KINDS } from "../shared/tests";
import { forMe, groupsOf, permanentKey } from "./Tests";
import type { Day } from "../shared/types";
import { PERIODS } from "../shared/periods";
import type { Cell } from "../shared/types";
import { held, startDay } from "./Timetable";
import { autoPeriod, roomsKey } from "./Rooms";
import { allRooms, freeRooms } from "./freeRooms";
import { WEEKDAYS, addDays, inMinutes, minutes, mondayOf, nowMinutesPrague, todayPrague, weekdayIndex } from "./time";
import { useCachedFetch } from "./useFetch";
import { useNow } from "./hooks";
import { CalendarIcon, DoorIcon, DoorOutIcon, GearIcon, TeacherIcon, TestIcon, RouteIcon, UtensilsIcon } from "./icons";
import { Chevron } from "./ui";

import { homeOrder, type Part, type Tab } from "./sections";
import { useUi } from "./theme";

const MORNING = 7 * 60; // from 7:00 the home tile names the day's subjects, before that only its span
const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n > 1 && n < 5 ? few : many);

/**
 * The launcher: every part of the app is a tile on one full-screen grid, and each tile already answers the
 * question it stands for (what's on now, is the weight room free, the average, the absence), from the last
 * loaded data. Only the timetable is refreshed here; the rest refresh when opened.
 *
 * Memoized: rendering reads every cached glance from localStorage (the free rooms from the whole school week),
 * which on the frame a screen starts growing out of its tile is a dropped frame. It renders again when `refresh`
 * changes (a screen closed, the order changed); App sets `inert` on it directly.
 */
export const Home = memo(function Home({ onOpen, onError, homeRef }: {
  onOpen: (tab: Tab) => void;
  onError: (e: unknown) => boolean;
  homeRef: Ref<HTMLDivElement>;
  refresh: number;
}) {
  const now = useNow();
  const today = todayPrague();
  const day = startDay(cache.get<TimetableResponse>(`timetable:${mondayOf(today)}`)?.days);
  const week = useCachedFetch<TimetableResponse>(`timetable:${mondayOf(day)}`, () => api.timetable(mondayOf(day)), onError);
  // Also the class's tests: a quick database read, and the one tile that tells about other people's news.
  useCachedFetch<UpcomingTests>("tests:upcoming", api.upcomingTests, () => true);
  const me = cache.get<{ name: string | null }>("me");
  const ui = useUi();
  const order = homeOrder();

  if (ui === "new")
    // The new look: the timetable card, the first four parts as widgets, the rest (and Settings) as one list.
    return (
      <div className="home" ref={homeRef}>
        <nav className="overview" aria-label="Aplikace">
          <TimetableTile day={day} days={week.data?.week === mondayOf(day) ? week.data.days : undefined} now={now} loading={week.loading} onOpen={onOpen} />
          <div className="widgets">
            {order.slice(0, 4).map((part) => (
              <Mode.Provider key={part} value="widget">
                <PartTile part={part} now={now} onOpen={onOpen} />
              </Mode.Provider>
            ))}
          </div>
          <div className="list home-list">
            {order.slice(4).map((part) => (
              <Mode.Provider key={part} value="row">
                <PartTile part={part} now={now} onOpen={onOpen} />
              </Mode.Provider>
            ))}
            <Mode.Provider value="row">
              <Tile id="settings" label="Nastavení" icon={<GearIcon />} sub={me?.name ?? "Notifikace, Strava, vzhled"} onOpen={onOpen} />
            </Mode.Provider>
          </div>
        </nav>
      </div>
    );

  return (
    <div className="home" ref={homeRef}>
      <nav className="tiles" aria-label="Aplikace">
        <TimetableTile day={day} days={week.data?.week === mondayOf(day) ? week.data.days : undefined} now={now} loading={week.loading} onOpen={onOpen} />
        {order.map((part, i, all) => (
          <Mode.Provider key={part} value={all.length % 2 === 1 && i === all.length - 1 ? "slim" : "tile"}>
            <PartTile part={part} now={now} onOpen={onOpen} />
          </Mode.Provider>
        ))}
        <button className="tile glass tile-settings tile-slim" data-tile="settings" onClick={() => onOpen("settings")}>
          <span className="tile-icon">
            <GearIcon />
          </span>
          <span className="tile-body">
            <span className="tile-label">Nastavení</span>
            <span className="tile-sub">{me?.name ?? "Notifikace, Strava, vzhled"}</span>
          </span>
          <Chevron />
        </button>
      </nav>
    </div>
  );
});

/** How a part shows on the home screen. Original look: tiles in pairs, an odd last one a slim full-width bar like
 * Settings. New look: a widget (big value) or a row of the list under them. */
const Mode = createContext<"tile" | "slim" | "widget" | "row">("tile");

function Tile({ id, label, icon, value, valueClass, sub, onOpen }: {
  id: Tab;
  label: string;
  icon: ReactNode;
  value?: string;
  valueClass?: string;
  sub?: string;
  onOpen: (tab: Tab) => void;
}) {
  const mode = useContext(Mode);
  if (mode === "widget")
    return (
      <button className={`tile glass tile-widget tile-${id}`} data-tile={id} onClick={() => onOpen(id)}>
        <span className="widget-head">
          {icon}
          {label}
        </span>
        <span className="tile-body">
          {value && <span className={`tile-value ${valueClass ?? ""}`}>{value}</span>}
          {sub && <span className="tile-sub">{sub}</span>}
        </span>
      </button>
    );
  if (mode === "row")
    return (
      <button className={`row more-row home-row tint-${id}`} data-tile={id} onClick={() => onOpen(id)}>
        <span className="more-icon">{icon}</span>
        <span className="row-main">
          <span className="row-title">{label}</span>
          <span className="row-sub">{[value, sub].filter(Boolean).join(" · ")}</span>
        </span>
        <Chevron />
      </button>
    );
  if (mode === "slim")
    return (
      <button className={`tile glass tile-${id} tile-slim`} data-tile={id} onClick={() => onOpen(id)}>
        <span className="tile-icon">{icon}</span>
        <span className="tile-body">
          <span className="tile-label">{label}</span>
          <span className="tile-sub">{[value, sub].filter(Boolean).join(" · ")}</span>
        </span>
        <Chevron />
      </button>
    );
  return (
    <button className={`tile glass tile-${id}`} data-tile={id} onClick={() => onOpen(id)}>
      <span className="tile-icon">{icon}</span>
      <span className="tile-body">
        {value && <span className={`tile-value ${valueClass ?? ""}`}>{value}</span>}
        <span className="tile-label">{label}</span>
        {sub && <span className="tile-sub">{sub}</span>}
      </span>
    </button>
  );
}

/** The tiles under the timetable, in the order picked in Settings. */
function PartTile({ part, now, onOpen }: { part: Part; now: number; onOpen: (tab: Tab) => void }) {
  if (part === "ends") return <Tile id="ends" label="Kdo kdy končí" icon={<DoorOutIcon />} sub="Celý Hradec" onOpen={onOpen} />;
  if (part === "rooms") return <RoomsTile now={now} onOpen={onOpen} />;
  if (part === "teachers") return <Tile id="teachers" label="Učitelé" icon={<TeacherIcon />} sub="Kdo kde učí" onOpen={onOpen} />;
  if (part === "trips") return <Tile id="trips" label="SideQuesty" icon={<RouteIcon />} sub="Stihneš to?" onOpen={onOpen} />;
  if (part === "tests") return <TestsTile onOpen={onOpen} />;
  if (part === "lunch") return <LunchTile onOpen={onOpen} />;
  return null;
}

/** The next meal ordered in Strava: today's until lunch is over, then the next day's. */
function LunchTile({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const data = cache.get<CanteenResponse>("canteen");
  const today = todayPrague();
  const late = nowMinutesPrague() >= 14 * 60;
  const day = data?.days.find((d) => (d.date > today || (d.date === today && !late)) && !d.closed);
  const meal = day?.meals.find((m) => m.ordered);
  const when = !day ? "" : day.date === today ? "Dnes" : day.date === addDays(today, 1) ? "Zítra" : WEEKDAYS[weekdayIndex(day.date)];
  return (
    <Tile
      id="lunch"
      label="Obědy"
      icon={<UtensilsIcon />}
      value={meal?.number ? String(meal.number) : day && !meal ? "Nic" : undefined}
      sub={!data?.connected ? "Objednávky ze Stravy" : meal ? `${when} · ${meal.name}` : day ? `${when} nemáš objednáno` : "Jídelníček"}
      onOpen={onOpen}
    />
  );
}

function TimetableTile({ day, days, now, loading, onOpen }: {
  day: string;
  days?: TimetableResponse["days"];
  now: number;
  loading: boolean;
  onOpen: (tab: Tab) => void;
}) {
  const today = todayPrague();
  const ui = useUi();
  const lessons = held(days?.find((d) => d.date === day)?.lessons ?? []);
  const live = day === today;
  const current = live ? lessons.find((l) => minutes(l.start) <= now && now < minutes(l.end)) : undefined;
  const next = lessons.find((l) => !live || minutes(l.start) > now);
  const dayName = day === addDays(today, 1) ? "Zítra" : WEEKDAYS[weekdayIndex(day)];

  let eyebrow = "";
  let title = "Rozvrh";
  let room = "";
  let meta = loading ? "Načítám…" : "Otevři rozvrh";
  let progress: number | null = null;
  // School's out for today, or it's the early morning before it: just how long the day is, subjects from 7:00.
  const overview = lessons.length > 0 && !current && (!live || now < MORNING);
  if (days && !lessons.length) {
    eyebrow = live ? "Dnes" : dayName;
    title = "Volno";
    meta = "Žádná hodina";
  } else if (overview) {
    eyebrow = live ? "Dnes" : dayName;
    const start = lessons.reduce((a, l) => (minutes(l.start) < minutes(a.start) ? l : a)).start;
    const end = lessons.reduce((a, l) => (minutes(l.end) > minutes(a.end) ? l : a)).end;
    title = `${start}–${end}`;
    meta = `${lessons.length} ${plural(lessons.length, "hodina", "hodiny", "hodin")}`;
  } else if (current) {
    eyebrow = `Teď · končí ${inMinutes(minutes(current.end) - now)}`;
    title = current.subject;
    room = current.room;
    meta = next ? `Pak ${next.subject} · ${next.room}` : "Poslední hodina";
    progress = (now - minutes(current.start)) / (minutes(current.end) - minutes(current.start));
  } else if (next && live) {
    eyebrow = `Další · ${inMinutes(minutes(next.start) - now)}`;
    title = next.subject;
    room = next.room;
    meta = `${next.start}–${next.end} · ${next.teacher}`;
  }

  return (
    <button className="tile glass tile-timetable" data-tile="timetable" onClick={() => onOpen("timetable")}>
      <span className="tile-top">
        <span className="tile-icon">
          <CalendarIcon />
        </span>
        <span className="tile-label">Rozvrh</span>
        {eyebrow && <span className="tile-eyebrow">{eyebrow}</span>}
      </span>
      <span className="tile-body">
        <span className="hero-main">
          <span className={`hero-subject ${overview ? "hero-span" : ""}`}>{title}</span>
          {room && <span className="hero-room">{room}</span>}
        </span>
        <span className="tile-sub">{meta}</span>
        {ui === "new" && live && lessons.length > 0 ? (
          // New look: the whole day as one segment per lesson, filled as it passes.
          <span className="hero-segments" aria-hidden="true">
            {lessons.map((l) => (
              <span key={l.start} className={minutes(l.start) <= now && now < minutes(l.end) ? "now" : ""}>
                <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, (now - minutes(l.start)) / (minutes(l.end) - minutes(l.start))))})` }} />
              </span>
            ))}
          </span>
        ) : (
          progress !== null && (
            <span className="hero-progress" aria-hidden="true">
              <span style={{ transform: `scaleX(${progress})` }} />
            </span>
          )
        )}
      </span>
    </button>
  );
}

/** How many classrooms are free in the period on now (or next), from the last read of this week's school timetable. */
function RoomsTile({ now, onOpen }: { now: number; onOpen: (tab: Tab) => void }) {
  const today = todayPrague();
  const week = cache.get<Cell[][]>(roomsKey(today));
  const day = week?.[weekdayIndex(today)];
  let value: string | undefined;
  let sub = "Kde je volno";
  if (week && day?.length) {
    const p = autoPeriod(day, true, now);
    const [start, end] = PERIODS[p];
    if (now < minutes(end)) {
      const n = freeRooms(allRooms(week), day, p).length;
      value = `${n} ${plural(n, "volná", "volné", "volných")}`;
      sub = minutes(start) <= now ? "Právě teď" : `Od ${start}`;
    }
  }
  return <Tile id="rooms" label="Volné učebny" icon={<DoorIcon />} value={value} valueClass="free" sub={sub} onOpen={onOpen} />;
}

/** The class's next test, and how many there are this coming week. */
function TestsTile({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const today = todayPrague();
  const groups = groupsOf(cache.get<Day[][]>(permanentKey(mondayOf(today))));
  const tests = (cache.get<UpcomingTests>("tests:upcoming")?.tests ?? [])
    .filter((t) => !t.hidden && t.date >= today && forMe(t, groups))
    .sort((a, b) => a.date.localeCompare(b.date) || minutes(a.start) - minutes(b.start));
  const week = tests.filter((t) => t.date <= addDays(today, 6)).length;
  const next = tests[0];
  const when = next && (next.date === today ? "dnes" : next.date === addDays(today, 1) ? "zítra" : WEEKDAYS[weekdayIndex(next.date)].toLowerCase());
  return (
    <Tile
      id="tests"
      label="Testy"
      icon={<TestIcon />}
      value={week ? String(week) : undefined}
      sub={next ? `${TEST_KINDS[next.kind]} ${next.subject} ${when}` : "Co nás ve třídě čeká"}
      onOpen={onOpen}
    />
  );
}

