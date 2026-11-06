import { useState } from "react";
import { api, cache, type TimetableDay, type TimetableResponse } from "./api";
import type { Lesson } from "../worker/parse";
import { DayPager, DayStrip, Empty, LargeHeader, SkeletonList } from "./ui";
import { addDays, longDate, minutes, mondayOf, todayPrague, weekdayIndex } from "./time";
import { useCachedFetch } from "./useFetch";
import { CalendarOffIcon, SunIcon } from "./icons";
import { held, startDay } from "./Timetable";
import { LIMIT, blockers, budgets, semesterEnd, verdict } from "./absencePlan";

/** A lesson the student plans to skip; `key` tells it apart from the same subject at another time. */
export interface PlannedSkip {
  key: string;
  date: string;
  subject: string;
}

const lessonKey = (date: string, l: Lesson) => `${date}|${l.start}|${l.subject}|${l.group}`;
const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n > 1 && n < 5 ? few : many);
const hours = (n: number) => `${n} ${plural(n, "hodina", "hodiny", "hodin")}`;

const PILL = { ok: "Můžeš", last: "Naposled", no: "Ne", unknown: "?" } as const;

/**
 * The real timetable (with substitutions) day by day, each lesson marked with whether it can be skipped without
 * ending the semester over LIMIT. Tapping a lesson plans it as skipped, and everything recounts with it.
 */
export function AbsenceCalc({ reserves, planned, onPlanned, onError }: {
  /** Lessons each subject can still miss this semester; null where it isn't known. */
  reserves: Map<string, number | null>;
  planned: PlannedSkip[];
  onPlanned: (p: PlannedSkip[]) => void;
  onError: (e: unknown) => boolean;
}) {
  const today = todayPrague();
  const [selected, setSelected] = useState(() => startDay(cache.get<TimetableResponse>(`timetable:${mondayOf(today)}`)?.days));
  const monday = mondayOf(selected);
  const { data, loading, error } = useCachedFetch<TimetableResponse>(`timetable:${monday}`, () => api.timetable(monday), onError);
  const days = data?.week === monday ? data.days : [];

  return (
    <div className="screen">
      <LargeHeader title="Co vynechat" subtitle={longDate(selected)} loading={loading}>
        <DayStrip monday={monday} selected={selected} onSelect={setSelected} />
      </LargeHeader>
      {error && <p className="banner">Rozvrh se nepodařilo obnovit. Zobrazuji poslední uložený.</p>}
      <DayPager index={weekdayIndex(selected)} onIndex={(i) => setSelected(addDays(monday, i))}>
        {[0, 1, 2, 3, 4].map((i) => {
          const date = addDays(monday, i);
          const day = days.find((d) => d.date === date);
          if (date < today) return <Empty key={i} icon={<CalendarOffIcon size={40} />} title="Už proběhlo" text="Počítám jen s hodinami, které tě ještě čekají." />;
          if (date > semesterEnd(today))
            return <Empty key={i} icon={<CalendarOffIcon size={40} />} title="Další pololetí" text="Absence se počítá zvlášť za každé pololetí." />;
          if (day) return <DayCalc key={date} day={day} reserves={reserves} planned={planned} onPlanned={onPlanned} />;
          return loading ? <SkeletonList key={i} count={7} side /> : <Empty key={i} icon={<CalendarOffIcon size={40} />} title="Žádná data" />;
        })}
      </DayPager>
    </div>
  );
}

function DayCalc({ day, reserves, planned, onPlanned }: {
  day: TimetableDay;
  reserves: Map<string, number | null>;
  planned: PlannedSkip[];
  onPlanned: (p: PlannedSkip[]) => void;
}) {
  const lessons = held(day.lessons).sort((a, b) => minutes(a.start) - minutes(b.start));
  if (!lessons.length) return <Empty icon={<SunIcon size={40} />} title="Volno" text="Tenhle den nemáš žádnou hodinu." />;

  const subjects = lessons.map((l) => l.subject);
  const isPlanned = new Set(planned.map((p) => p.key));
  const budget = budgets(reserves, planned.map((p) => p.subject));
  // The day on its own, as if nothing of it were planned yet: the summary doesn't shift while tapping through it.
  const others = budgets(reserves, planned.filter((p) => p.date !== day.date).map((p) => p.subject));
  const perSubject = new Map<string, number>();
  for (const s of subjects) perSubject.set(s, (perSubject.get(s) ?? 0) + 1);
  const skippable = [...perSubject].reduce((sum, [s, n]) => sum + Math.min(n, Math.max(0, others.get(s) ?? 0)), 0);
  const blocked = blockers(others, subjects);
  const plannedHere = planned.filter((p) => p.date === day.date);

  const toggle = (l: Lesson) => {
    const key = lessonKey(day.date, l);
    onPlanned(isPlanned.has(key) ? planned.filter((p) => p.key !== key) : [...planned, { key, date: day.date, subject: l.subject }]);
  };
  const toggleDay = () => {
    const rest = planned.filter((p) => p.date !== day.date);
    onPlanned(plannedHere.length ? rest : [...rest, ...lessons.map((l) => ({ key: lessonKey(day.date, l), date: day.date, subject: l.subject }))]);
  };

  return (
    <div className="stagger">
      <div className="summary-card">
        <div>
          <p className="eyebrow">Můžeš vynechat</p>
          <p className={`summary-value ${skippable === lessons.length ? "great" : skippable ? "meh" : "bad"}`}>
            {skippable}
            <small> z {hours(lessons.length)}</small>
          </p>
        </div>
        <div className="summary-side">
          {blocked.length ? (
            <>
              <span>Celý den ne kvůli</span>
              <span className="warn">{blocked.join(", ")}</span>
            </>
          ) : (
            <span className="ok">Celý den v pohodě</span>
          )}
        </div>
      </div>

      <ol className="timeline">
        {lessons.map((l) => {
          const key = lessonKey(day.date, l);
          const left = budget.get(l.subject) ?? null;
          const on = isPlanned.has(key);
          // A planned lesson is already taken off `left`; whether it fits is whether that stayed at 0 or above.
          const v = on ? (left === null ? "unknown" : left >= 0 ? "ok" : "no") : verdict(left);
          const note = on
            ? left !== null && left < 0
              ? `Tímhle bys skončil nad ${LIMIT} %`
              : left !== null
                ? `Pak můžeš vynechat ještě ${hours(left)}`
                : "Vynechám"
            : { ok: `Můžeš vynechat ještě ${hours(left ?? 0)}`, last: "Poslední hodina, kterou můžeš vynechat", no: `Skončil bys nad ${LIMIT} %`, unknown: "Nevím, kolik hodin zbývá" }[v];
          return (
            <li key={key}>
              <button className={`lesson-card skip-card skip-${v} ${on ? "planned" : ""}`} aria-pressed={on} onClick={() => toggle(l)}>
                <div className="lesson-time">
                  <span>{l.start}</span>
                  <span>{l.end}</span>
                </div>
                <div className="lesson-main">
                  <div className="lesson-subject">
                    {l.subject}
                    {l.group && <span className="tag">sk. {l.group}</span>}
                  </div>
                  <div className="lesson-teacher skip-note">{note}</div>
                </div>
                <span className="skip-pill">{on ? "Vynechám" : PILL[v]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="list skip-actions">
        <button className="row row-button" onClick={toggleDay}>
          {plannedHere.length ? "Zrušit plán tohoto dne" : "Vynechat celý den"}
        </button>
        {planned.length > plannedHere.length && (
          <button className="row row-button destructive" onClick={() => onPlanned([])}>
            Zrušit celý plán ({hours(planned.length)})
          </button>
        )}
      </div>
      <p className="list-footer">
        Klepnutím na hodinu si ji naplánuješ jako vynechanou a zbytek se přepočítá, i v ostatních dnech. Hranice je {LIMIT} %
        za pololetí z každého předmětu. Kolik hodin do konce pololetí zbývá, je odhad podle stálého rozvrhu, bez suplování a akcí.
      </p>
    </div>
  );
}
