import { useEffect, useRef, useState } from "react";
import { api, cache } from "./api";
import { PERIODS, type Cell } from "../shared/schoolOcr";
import { allRooms, blocksAt, freeRooms } from "./freeRooms";
import { readSchoolFile, schoolFile, type SchoolWeeks } from "./school";
import { Empty, LargeHeader, Section, SkeletonList, DayStrip } from "./ui";
import { addDays, defaultSchoolDay, longDate, minutes, mondayOf, nextSchoolDay, nowMinutesPrague, todayPrague, weekdayIndex } from "./time";
import { useCachedFetch } from "./useFetch";
import { useNow } from "./hooks";
import { AlertIcon, CalendarOffIcon, DoorIcon } from "./icons";

/** Cache key of a week's five school days, read from images "1" or "2". */
export const roomsKey = (weeks: SchoolWeeks | null | undefined, iso: string) => {
  const file = schoolFile(weeks, iso);
  return file ? `rooms:${file.slice(2)}:${mondayOf(iso)}` : null;
};

export const lastPeriodOf = (day: Cell[]) => Math.max(8, ...day.map((c) => c.period));

/** Period to show first: the one on now (or next) today, otherwise the first one anybody has. */
export function autoPeriod(day: Cell[], live: boolean, now: number) {
  const first = day.length ? Math.min(...day.map((c) => c.period)) : 1;
  if (!live) return first;
  const last = lastPeriodOf(day);
  const current = PERIODS.findIndex(([, end], p) => p <= last && now < minutes(end));
  return current < 0 ? last : Math.max(first, current);
}

/** Today until its last period is over, then the next school day; decided from cache so it doesn't flip after a paint. */
export function schoolStartDay() {
  const today = todayPrague();
  const day = defaultSchoolDay();
  const key = roomsKey(cache.get<SchoolWeeks>("school-weeks"), today);
  const week = key && cache.get<Cell[][]>(key);
  if (day !== today || !week) return day;
  return nowMinutesPrague() >= minutes(PERIODS[lastPeriodOf(week[weekdayIndex(today)])][1]) ? nextSchoolDay(today) : today;
}

/** The school timetable of `selected`'s whole week: the room list comes from all of it, and switching days is then instant. */
export function useSchoolWeek(selected: string, onError: (e: unknown) => boolean) {
  const weeks = useCachedFetch("school-weeks", api.schoolWeeks, onError);
  const key = roomsKey(weeks.data, selected);
  const monday = mondayOf(selected);
  const week = useCachedFetch<Cell[][]>(
    key,
    () => {
      const files = [0, 1, 2, 3, 4].map((i) => schoolFile(weeks.data, addDays(monday, i)));
      return Promise.all(files.map((f) => (f ? readSchoolFile(f) : Promise.resolve([]))));
    },
    onError,
  );
  return { weeks, key, week };
}

/** Free classrooms: every room the school timetable uses this week, minus the ones taken in the chosen period. */
export function Rooms({ onError }: { onError: (e: unknown) => boolean }) {
  const [selected, setSelected] = useState(schoolStartDay);
  const [picked, setPicked] = useState<number | null>(null);
  const { weeks, key, week } = useSchoolWeek(selected, onError);
  const monday = mondayOf(selected);
  const now = useNow();

  const live = selected === todayPrague();
  const day = week.data?.[weekdayIndex(selected)] ?? [];
  const rooms = week.data ? allRooms(week.data) : [];
  const last = lastPeriodOf(day);
  const period = Math.min(picked ?? autoPeriod(day, live, now), last);
  const free = freeRooms(rooms, day, period);
  const blocks = blocksAt(day, period);
  const [start, end] = PERIODS[period];
  const isNow = live && minutes(start) <= now && now < minutes(end);

  const pick = (iso: string) => {
    setSelected(iso);
    setPicked(null);
  };

  return (
    <div className="screen">
      <LargeHeader title="Volné učebny" subtitle={longDate(selected)} loading={weeks.loading || week.loading}>
        <DayStrip monday={monday} selected={selected} onSelect={pick} />
        {key && week.data && <PeriodStrip last={last} period={period} live={live} now={now} onPick={setPicked} />}
      </LargeHeader>
      <div className="scroll">
        {weeks.data && !key ? (
          <Empty icon={<CalendarOffIcon size={40} />} title="Mimo rozsah" text="Škola zveřejňuje rozvrh jen na tento a příští týden." />
        ) : week.error ? (
          <Empty icon={<AlertIcon size={40} />} title="Rozvrh školy se nepodařilo načíst" />
        ) : !week.data ? (
          <SkeletonList count={8} lines={1} />
        ) : !rooms.length ? (
          <Empty icon={<CalendarOffIcon size={40} />} title="Tento týden se neučí" text="Rozvrh školy nemá žádnou hodinu." />
        ) : !free.length ? (
          <Empty icon={<DoorIcon size={40} />} title="Všechno obsazeno" text={`V ${period}. hodině se učí ve všech ${rooms.length} učebnách.`} />
        ) : (
          <Section
            grid
            title={`${isNow ? "Teď volné" : "Volné"} · ${start}–${end}`}
            footer={
              blocks.length
                ? `V této hodině běží ${blocks.join(", ")}. Rozvrh školy neukazuje, ve kterých učebnách, takže některá z volných může být obsazená.`
                : `${free.length} z ${rooms.length} učeben. Podle veřejného rozvrhu školy, konzultace a akce mimo rozvrh tu nejsou.`
            }
          >
            {free.map(({ room, until }) => (
              <div key={room} className="row room-row">
                <span className="room-name">{room}</span>
                <span className="pill-status free">{until === null ? "do konce dne" : `do ${PERIODS[until][0]}`}</span>
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

export function PeriodStrip({ last, period, live, now, onPick }: { last: number; period: number; live: boolean; now: number; onPick: (p: number) => void }) {
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [period]);
  return (
    <div className="period-strip" role="tablist" aria-label="Hodina">
      {PERIODS.slice(0, last + 1).map(([start, end], p) => (
        <button
          key={p}
          ref={p === period ? active : undefined}
          role="tab"
          aria-selected={p === period}
          className={`period-chip ${p === period ? "active" : ""} ${live && minutes(end) <= now ? "past" : ""}`}
          onClick={() => onPick(p)}
        >
          <b>{p}.</b>
          <span>{start}</span>
        </button>
      ))}
    </div>
  );
}
