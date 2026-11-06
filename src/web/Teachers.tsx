import { useState } from "react";
import { PERIODS } from "../shared/schoolOcr";
import { PeriodStrip, autoPeriod, lastPeriodOf, schoolStartDay, useSchoolWeek } from "./Rooms";
import { teachersAt } from "./whoTeaches";
import { Empty, LargeHeader, Section, SkeletonList, DayStrip } from "./ui";
import { longDate, minutes, mondayOf, todayPrague, weekdayIndex } from "./time";
import { useNow } from "./hooks";
import { AlertIcon, CalendarOffIcon, SearchIcon, TeacherIcon } from "./icons";

/** Where each teacher is in the chosen period, read off the school timetable like the free rooms. */
export function Teachers({ onError }: { onError: (e: unknown) => boolean }) {
  const [selected, setSelected] = useState(schoolStartDay);
  const [picked, setPicked] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const { weeks, key, week } = useSchoolWeek(selected, onError);
  const now = useNow();

  const live = selected === todayPrague();
  const day = week.data?.[weekdayIndex(selected)] ?? [];
  const last = lastPeriodOf(day);
  const period = Math.min(picked ?? autoPeriod(day, live, now), last);
  const [start, end] = PERIODS[period];
  const isNow = live && minutes(start) <= now && now < minutes(end);
  const q = query.trim().toUpperCase();
  const match = (t: { teacher: string }) => !q || t.teacher.toUpperCase().includes(q);
  const all = teachersAt(day, period);
  const teaching = all.teaching.filter(match);
  const free = all.free.filter(match);

  const pick = (iso: string) => {
    setSelected(iso);
    setPicked(null);
  };

  return (
    <div className="screen">
      <LargeHeader title="Učitelé" subtitle={longDate(selected)} loading={weeks.loading || week.loading}>
        <DayStrip monday={mondayOf(selected)} selected={selected} onSelect={pick} />
        {key && week.data && <PeriodStrip last={last} period={period} live={live} now={now} onPick={setPicked} />}
      </LargeHeader>
      <div className="scroll">
        {weeks.data && !key ? (
          <Empty icon={<CalendarOffIcon size={40} />} title="Mimo rozsah" text="Škola zveřejňuje rozvrh jen na tento a příští týden." />
        ) : week.error ? (
          <Empty icon={<AlertIcon size={40} />} title="Rozvrh školy se nepodařilo načíst" />
        ) : !week.data ? (
          <SkeletonList count={8} lines={1} />
        ) : !day.length ? (
          <Empty icon={<CalendarOffIcon size={40} />} title="Tento den se neučí" text="Rozvrh školy nemá žádnou hodinu." />
        ) : (
          <>
            <label className="search">
              <SearchIcon size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Zkratka učitele, třeba HU"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-label="Hledat učitele"
              />
            </label>
            {!teaching.length && !free.length ? (
              <Empty icon={<TeacherIcon size={40} />} title="Nikdo takový" text={`Tento den neučí nikdo se zkratkou ${q}.`} />
            ) : (
              <>
                {teaching.length > 0 && (
                  <Section title={`${isNow ? "Teď učí" : "Učí"} · ${start}–${end}`}>
                    {teaching.map((t) => (
                      <div key={t.teacher} className="row teacher-row">
                        <span className="room-name">{t.teacher}</span>
                        <span className="teacher-what">
                          {t.subject}
                          <small>{t.classes.join(", ")}</small>
                        </span>
                        <span className={`pill-status done ${t.changed ? "changed" : ""}`}>{t.rooms.join(", ") || "blok"}</span>
                      </div>
                    ))}
                  </Section>
                )}
                {free.length > 0 && (
                  <Section
                    grid
                    title="Neučí"
                    footer="Podle veřejného rozvrhu školy: kdo v té hodině neučí, nemusí být ve škole. Suplování se tu objeví, až ho škola zanese do rozvrhu."
                  >
                    {free.map((t) => (
                      <div key={t.teacher} className="row room-row">
                        <span className="room-name">{t.teacher}</span>
                        <span className={`pill-status ${t.next === null ? "done past" : "free"}`}>
                          {t.next === null ? "dnes už neučí" : `učí od ${PERIODS[t.next][0]}`}
                        </span>
                      </div>
                    ))}
                  </Section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
