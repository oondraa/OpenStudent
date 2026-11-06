import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api, cache, type LunchResponse, type TestsResponse, type TimetableDay, type TimetableResponse } from "./api";
import { TEST_KINDS, sameLesson, type TestItem } from "../shared/tests";
import type { Lesson } from "../worker/parse";
import type { LunchDay } from "../worker/strava";
import { Chevron, DayPager, DayStrip, Empty, LargeHeader, SkeletonList } from "./ui";
import { WEEKDAYS, addDays, defaultSchoolDay, inMinutes, longDate, minutes, mondayOf, nextSchoolDay, nowMinutesPrague, todayPrague, weekdayIndex } from "./time";
import { useCachedFetch } from "./useFetch";
import { PERIODS } from "../shared/schoolOcr";
import { useDesktop, useNow, useScrollToFocus } from "./hooks";
import { CalendarOffIcon, SunIcon, UtensilsIcon } from "./icons";

/** Today until its last lesson is over, then the next school day: nobody opens the app to see what already was. */
export function startDay(days: TimetableDay[] | undefined) {
  const today = todayPrague();
  const day = defaultSchoolDay();
  const lessons = held(days?.find((d) => d.date === today)?.lessons ?? []);
  if (day !== today || !lessons.length) return day;
  return nowMinutesPrague() >= Math.max(...lessons.map((l) => minutes(l.end))) ? nextSchoolDay(today) : today;
}

/** Lessons that actually take place: SIS keeps a cancelled one in the day, struck out. */
export const held = (lessons: Lesson[]) => lessons.filter((l) => !l.cancelled);

export function Timetable({ onError }: { onError: (e: unknown) => boolean }) {
  const [selected, setSelectedState] = useState(() => startDay(cache.get<TimetableResponse>(`timetable:${mondayOf(todayPrague())}`)?.days));
  const touched = useRef(false);
  const setSelected = (iso: string) => {
    touched.current = true;
    setSelectedState(iso);
  };
  const monday = mondayOf(selected);
  const today = todayPrague();
  const now = useNow();
  const { data, loading, error } = useCachedFetch<TimetableResponse>(`timetable:${monday}`, () => api.timetable(monday), onError);
  const days = data?.week === monday ? data.days : [];
  // Canteen orders (Strava), when connected in Settings. A failure just leaves the plain lunch card.
  const lunch = useCachedFetch<LunchResponse>("lunch", api.lunch, onError);
  // Strava lists days from today ~3 weeks ahead; outside that range there's nothing to say.
  const lunchFor = (date: string) => {
    const ds = lunch.data?.connected ? lunch.data.days : [];
    if (!ds.length || date < ds[0].date || date > ds[ds.length - 1].date) return undefined;
    return ds.find((d) => d.date === date) ?? { date, ordered: null };
  };

  // Without a cached timetable the first guess is today; correct it once this week's lessons arrive.
  useEffect(() => {
    if (touched.current || data?.week !== mondayOf(today)) return;
    const day = startDay(data.days);
    if (day !== selected) setSelectedState(day);
  }, [data]);

  const todayDay = selected === today ? days.find((d) => d.date === today) : undefined;
  const todayLessons = held(todayDay?.lessons ?? []);
  const current = todayLessons.find((l) => minutes(l.start) <= now && now < minutes(l.end));
  const next = todayLessons.find((l) => minutes(l.start) > now);
  const desktop = useDesktop();
  const shown = useRef<{ current?: Lesson; next?: Lesson } | null>(null);
  if (current || next) shown.current = { current, next };

  // Tests the class marked on its lessons (added and changed on the Testy screen; here they're only shown).
  const testsFetch = useCachedFetch<TestsResponse>(`tests:${monday}`, () => api.tests(monday), onError);
  const tests = testsFetch.data?.week === monday ? testsFetch.data.tests.filter((t) => !t.hidden) : [];
  // The week's earliest first period: a day starting later shows the periods it skips, so the days line up.
  const from = Math.min(...days.map(firstPeriod).filter((p): p is number => p !== null));

  return (
    <TestsContext.Provider value={tests}>
    <div className="screen">
      <LargeHeader title="Rozvrh" subtitle={longDate(selected)} loading={loading}>
        <DayStrip monday={monday} selected={selected} onSelect={setSelected} />
      </LargeHeader>
      {error && <p className="banner">Rozvrh se nepodařilo obnovit. Zobrazuji poslední uložený.</p>}
      {/* Stays mounted and collapses (or grows back) while the days slide, instead of vanishing on the first frame
          and yanking the list up mid-glide. While collapsing it keeps showing the last lesson it had. */}
      <div className="collapse now-collapse" data-open={!!(current || next)} aria-hidden={!(current || next)}>
        <div className="collapse-inner">{shown.current && <NowCard {...shown.current} now={now} />}</div>
      </div>
      {desktop ? (
        // A computer has room for the whole week side by side; the day strip still moves weeks and marks a day.
        <div className="scroll">
          <div className="week-grid">
            {[0, 1, 2, 3, 4].map((i) => {
              const date = addDays(monday, i);
              const day = days.find((d) => d.date === date);
              return (
                <section key={date} className={`week-day ${date === selected ? "selected" : ""} ${date === today ? "today" : ""}`}>
                  <button className="week-day-head" onClick={() => setSelected(date)}>
                    {WEEKDAYS[i]} <span>{Number(date.slice(8))}. {Number(date.slice(5, 7))}.</span>
                  </button>
                  {day ? (
                    <DayView day={day} live={date === today} now={now} meal={lunchFor(date)} from={from} grid scroll={false} />
                  ) : loading ? (
                    <SkeletonList count={6} />
                  ) : (
                    <Empty icon={<CalendarOffIcon size={32} />} title="Žádná data" />
                  )}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <DayPager index={weekdayIndex(selected)} onIndex={(i) => setSelected(addDays(monday, i))}>
          {[0, 1, 2, 3, 4].map((i) => {
            const day = days.find((d) => d.date === addDays(monday, i));
            if (day) return <DayView key={day.date} day={day} live={day.date === today} now={now} meal={lunchFor(day.date)} from={from} />;
            return loading ? <SkeletonList key={i} count={7} side /> : <Empty key={i} icon={<CalendarOffIcon size={40} />} title="Žádná data" />;
          })}
        </DayPager>
      )}
    </div>
    </TestsContext.Provider>
  );
}

/** The week's tests the classmates haven't hidden, for the lessons to show. */
const TestsContext = createContext<TestItem[]>([]);

/** Number of the school period a lesson starts in ("1–2" → 1), null when it fits none. */
function periodNumber(l: { start: string; end: string }) {
  const p = periodOf(l);
  return p ? Number(p.split("–")[0]) : null;
}

/** The period the day's first lesson (a cancelled one with nothing in its place too) starts in. */
function firstPeriod(day: TimetableDay) {
  const first = dayItems(day).find((it) => it.kind === "lesson");
  return first ? periodNumber(first) : null;
}

type Item =
  | { kind: "lesson"; lesson: Lesson; start: string; end: string; was?: Lesson[] }
  | { kind: "lunch"; start: string; end: string }
  | { kind: "free"; start: string; end: string };

const LUNCH_MIN = 30; // eating takes about this long; SIS marks the whole window the canteen serves in
const FREE_MIN = 20; // a gap at least this long gets its own row; shorter ones are ordinary breaks
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const span = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

/**
 * Lessons with what's between them: a long gap shows as free time, and lunch takes only its ~30 minutes of it
 * (at the start of the gap, or when the canteen opens), so a two-hour break doesn't hide behind the lunch card.
 * Cancelled lessons don't take up time: one with something else taught in its slot folds into that lesson as `was`
 * (what it replaced), one with nothing in its place keeps its own row, slotted in by its start.
 */
export function dayItems(day: TimetableDay): Item[] {
  const lessons = held(day.lessons).sort((a, b) => minutes(a.start) - minutes(b.start));
  const items: Item[] = [];
  const lunch = day.lunch && { start: minutes(day.lunch.start), end: minutes(day.lunch.end) };
  let lunchPlaced = false;
  const free = (a: number, b: number) => b - a >= FREE_MIN && items.push({ kind: "free", start: hhmm(a), end: hhmm(b) });
  lessons.forEach((lesson, i) => {
    items.push({ kind: "lesson", lesson, start: lesson.start, end: lesson.end });
    const next = lessons[i + 1];
    if (!next) return;
    const g0 = minutes(lesson.end);
    const g1 = minutes(next.start);
    if (lunch && !lunchPlaced && lunch.start < g1 && lunch.end > g0 && g1 - Math.max(g0, lunch.start) >= 15) {
      const ls = Math.max(g0, lunch.start);
      const le = Math.min(ls + LUNCH_MIN, g1);
      free(g0, ls);
      items.push({ kind: "lunch", start: hhmm(ls), end: hhmm(le) });
      free(le, g1);
      lunchPlaced = true;
    } else free(g0, g1);
  });
  // Lunch outside the lessons (after the last one, or no gap fits it): where SIS puts it, ~30 minutes long.
  if (lunch && !lunchPlaced) items.push({ kind: "lunch", start: hhmm(lunch.start), end: hhmm(Math.min(lunch.start + LUNCH_MIN, lunch.end)) });
  for (const lesson of day.lessons) {
    if (!lesson.cancelled) continue;
    // Its slot is whatever overlaps it in time: SIS can shift the replacement by a few minutes (12:45 for a 12:55).
    // Of those, the one of the same subject or group took its place, else the one overlapping it most.
    const overlap = (it: Item) => Math.min(minutes(it.end), minutes(lesson.end)) - Math.max(minutes(it.start), minutes(lesson.start));
    const slot = items
      .filter((it): it is Item & { kind: "lesson" } => it.kind === "lesson" && !it.lesson.cancelled && overlap(it) > 0)
      .sort((a, b) => overlap(b) - overlap(a));
    const by = slot.find((it) => it.lesson.subject === lesson.subject) ?? slot.find((it) => lesson.group && it.lesson.group === lesson.group) ?? slot[0];
    if (by) (by.was ??= []).push(lesson);
    else items.push({ kind: "lesson", lesson, start: lesson.start, end: lesson.end });
  }
  return items.sort((a, b) => minutes(a.start) - minutes(b.start));
}

/**
 * School periods a lesson spans ("3", "1–2"), the way students count them. Some classes run shifted (12:55–13:40
 * for the 12:45 period): such a lesson counts as the period it mostly overlaps. Empty when it overlaps none by half.
 */
export function periodOf(l: { start: string; end: string }) {
  const s = minutes(l.start);
  const e = minutes(l.end);
  const covered = PERIODS.flatMap(([ps, pe], p) => {
    const overlap = Math.min(e, minutes(pe)) - Math.max(s, minutes(ps));
    return overlap * 2 >= minutes(pe) - minutes(ps) ? [p] : [];
  });
  if (!covered.length) return "";
  const [a, b] = [covered[0], covered[covered.length - 1]];
  return b > a ? `${a}–${b}` : `${a}`;
}

type State = "past" | "now" | "future";

/**
 * `scroll`: today's list jumps to what's on now. Off in the week view, where it would shift the other days too.
 * `from`: the week's earliest first period. A day starting later says so: in the week view (`grid`) with an empty
 * slot for each period it skips, so its lessons sit level with the other days', on a phone with one quiet line.
 */
function DayView({ day, live, now, meal, from, grid = false, scroll = true }: {
  day: TimetableDay;
  live: boolean;
  now: number;
  meal?: LunchDay;
  from: number;
  grid?: boolean;
  scroll?: boolean;
}) {
  const items = dayItems(day);
  const firstLesson = items.find((it) => it.kind === "lesson");
  const first = firstLesson ? periodNumber(firstLesson) : null;
  const skipped = first !== null && first > from ? first - from : 0;

  // First item that hasn't ended yet = what's on now, or next.
  const focus = live ? items.findIndex((it) => now < minutes(it.end)) : -1;
  const focusRef = useScrollToFocus(scroll && focus > 0);

  if (!day.lessons.length) return <Empty icon={<SunIcon size={40} />} title="Volno" text="Tenhle den nemáš žádnou hodinu." />;

  const state = (it: Item): State => (!live ? "future" : now >= minutes(it.end) ? "past" : now >= minutes(it.start) ? "now" : "future");
  const refAt = (i: number) => (i === focus ? (el: HTMLLIElement | null) => void (focusRef.current = el) : undefined);

  // Lessons that follow each other share one block; free time splits the day into blocks.
  const groups: ({ free: Item & { kind: "free" }; i: number } | { rows: { it: Item; i: number }[] })[] = [];
  items.forEach((it, i) => {
    const last = groups[groups.length - 1];
    if (it.kind === "free") groups.push({ free: it, i });
    else if (last && "rows" in last) last.rows.push({ it, i });
    else groups.push({ rows: [{ it, i }] });
  });

  return (
    <ol className="tt stagger">
      {skipped > 0 &&
        (grid ? (
          <li className="tt-ghost" style={{ "--n": skipped } as React.CSSProperties} aria-label={`Začíná ${first}. hodinou`}>
            {Array.from({ length: skipped }, (_, k) => (
              <span key={k}>{from + k}</span>
            ))}
          </li>
        ) : (
          <li className={`tt-free tt-late ${live && now >= minutes(firstLesson!.start) ? "past" : ""}`}>
            Začínáš {first}. hodinou
            <small>od {firstLesson!.start}</small>
          </li>
        ))}
      {groups.map((g) => {
        if ("free" in g) {
          const it = g.free;
          const s = state(it);
          return (
            <li key={`free-${it.start}`} ref={refAt(g.i)} className={`tt-free ${s}`}>
              {s === "now" ? `Volno ještě ${span(Math.max(1, Math.ceil(minutes(it.end) - now)))}` : `Volno ${span(minutes(it.end) - minutes(it.start))}`}
              <small>
                {it.start}–{it.end}
              </small>
            </li>
          );
        }
        return (
          <li key={`block-${g.rows[0].it.start}`}>
            <ol className="tt-block">
              {g.rows.map(({ it, i }) =>
                it.kind === "lesson" ? (
                  // Keyed by content, not SIS's debug id: a refresh must update rows in place, not remount them.
                  <LessonRow
                    key={`${it.start}-${it.lesson.subject}-${it.lesson.group}-${it.lesson.cancelled ? "x" : ""}`}
                    liRef={refAt(i)}
                    date={day.date}
                    lesson={it.lesson}
                    was={it.was}
                    state={state(it)}
                  />
                ) : (
                  <li key="lunch" ref={refAt(i)}>
                    <div className={`tt-row lunch ${state(it)}`}>
                      <span className="tt-period" aria-hidden="true">
                        <UtensilsIcon size={18} />
                      </span>
                      <span className="tt-main">
                        <span className="tt-subject">
                          <span className="tt-name">{meal?.ordered?.label ?? "Oběd"}</span>
                        </span>
                        <span className="tt-meta">
                          {it.start}–{it.end} · {meal ? (meal.ordered?.name ?? "Nemáš objednáno") : "Jídelna"}
                        </span>
                      </span>
                      <span className="tt-room">{meal?.ordered?.number}</span>
                    </div>
                  </li>
                ),
              )}
            </ol>
          </li>
        );
      })}
    </ol>
  );
}

function NowCard({ current, next, now }: { current?: Lesson; next?: Lesson; now: number }) {
  const l = current ?? next!;
  const progress = current ? (now - minutes(current.start)) / (minutes(current.end) - minutes(current.start)) : 0;
  return (
    <div className="now-wrap">
      <div className="now-card stagger">
        <p className="eyebrow">{current ? `Teď · končí ${inMinutes(minutes(current.end) - now)}` : `Další · ${inMinutes(minutes(l.start) - now)}`}</p>
        <div className="now-main">
          <span className="now-subject">{l.subject}</span>
          <span className="now-room">{l.room}</span>
        </div>
        <p className="now-meta">
          {l.teacher} · {l.start}–{l.end}
          {current && next && ` · pak ${next.subject} v ${next.room}`}
        </p>
        {current && (
          <div className="now-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** What a changed lesson's detail says: field by field what it was and is now, or why there's nothing to compare. */
function changeLines(l: Lesson, was?: Lesson[]): { label: string; from?: string; to: string }[] {
  if (l.cancelled) return [{ label: "Odpadá", to: [l.teacher, l.room && `učebna ${l.room}`].filter(Boolean).join(" · ") || "nic za ni není" }];
  if (was?.length) {
    return was.flatMap((o) => {
      const fields = [
        { label: "Předmět", from: o.subject, to: l.subject },
        { label: "Učitel", from: o.teacher, to: l.teacher },
        { label: "Učebna", from: o.room, to: l.room },
        { label: "Skupina", from: o.group, to: l.group },
      ].filter((f) => f.from !== f.to && (f.from || f.to));
      return fields.length ? fields : [{ label: "Odpadá", to: `${o.subject}, místo ní stejná hodina znovu` }];
    });
  }
  if (l.added) return [{ label: "Navíc", to: "v běžném rozvrhu tahle hodina není" }];
  return [{ label: "Změna", to: "SIS u hodiny hlásí změnu, ale neuvádí, co bylo původně" }];
}

/**
 * `was`: the cancelled lessons whose slot this one took. A changed row opens to show what's different. The class's
 * tests on the lesson show under it, in their own colour.
 */
function LessonRow({ lesson: l, date, state, was, liRef }: {
  lesson: Lesson;
  date: string;
  was?: Lesson[];
  state: State;
  liRef?: (el: HTMLLIElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const tests = useContext(TestsContext).filter((t) => !l.cancelled && sameLesson(t, date, l));
  const period = periodOf(l);
  const replaced = !!was?.length;
  const tag = l.cancelled ? "odpadá" : replaced ? (was!.some((o) => o.subject === l.subject) ? "změna" : "náhrada") : l.added ? "přidaná" : l.changed ? "změna" : "";
  const body = (
    <>
      <span className={`tt-period ${period.length > 2 ? "range" : ""}`}>{period}</span>
      <span className="tt-main">
        <span className="tt-subject">
          <span className="tt-name">{l.subject}</span>
          {tag && (
            <span className={`tag ${l.cancelled ? "" : "tag-accent"}`}>
              {tag}
              <Chevron dir={open ? "up" : "down"} />
            </span>
          )}
        </span>
        <span className="tt-meta">
          {l.start}–{l.end}
          {l.teacher && ` · ${l.teacher}`}
          {l.group && ` · sk. ${l.group}`}
        </span>
        {tests.map((t) => (
          <span key={t.id} className="tt-test">
            <span className="tt-test-kind">{TEST_KINDS[t.kind]}</span>
            {t.note && <span className="tt-test-note">{t.note}</span>}
          </span>
        ))}
      </span>
      <span className="tt-room">{l.room}</span>
    </>
  );
  const cls = `tt-row ${state} ${l.cancelled ? "cancelled" : l.changed || l.added || replaced ? "changed" : ""} ${tests.length ? "has-test" : ""}`;
  if (!tag)
    return (
      <li ref={liRef}>
        {l.meet ? (
          <a className={cls} href={l.meet} target="_blank" rel="noreferrer" aria-label={`${l.subject}, otevřít Meet`}>
            {body}
          </a>
        ) : (
          <div className={cls}>{body}</div>
        )}
      </li>
    );
  return (
    <li ref={liRef}>
      <button className={cls} aria-expanded={open} onClick={() => setOpen(!open)}>
        {body}
      </button>
      <div className="collapse" data-open={open} inert={!open}>
        <div className="collapse-inner">
          <dl className="tt-change">
            {changeLines(l, was).map((c, i) => (
              <div key={i}>
                <dt>{c.label}</dt>
                <dd>
                  {c.from !== undefined && (
                    <>
                      <s>{c.from || "–"}</s>
                      <span aria-hidden="true"> → </span>
                    </>
                  )}
                  {c.to || "–"}
                </dd>
              </div>
            ))}
            {l.meet && (
              <a className="tt-change-link" href={l.meet} target="_blank" rel="noreferrer">
                Otevřít Meet
              </a>
            )}
          </dl>
        </div>
      </div>
    </li>
  );
}
