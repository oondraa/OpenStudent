import { useEffect, useState } from "react";
import { api, cache, Unauthorized, type TimetableResponse, type UpcomingTests } from "./api";
import { TEST_KINDS, TEST_NOTE_MAX, sameLesson, type TestItem, type TestKind } from "../shared/tests";
import type { Day, Lesson } from "../worker/parse";
import { held, periodOf } from "./Timetable";
import { DayStrip, Empty, LargeHeader, Section, SkeletonList } from "./ui";
import { WEEKDAYS, addDays, longDate, minutes, mondayOf, nextSchoolDay, todayPrague, weekdayIndex } from "./time";
import { useCachedFetch } from "./useFetch";
import { PERIODS } from "../shared/schoolOcr";
import { AlertIcon, CalendarOffIcon, TestIcon } from "./icons";

/** "Dnes", "Zítra", else the weekday and date, with how far off it is. */
export function testDay(date: string, today = todayPrague()) {
  if (date === today) return "Dnes";
  if (date === addDays(today, 1)) return "Zítra";
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  const when = days < 5 ? `za ${days} dny` : `za ${days} dní`;
  return `${WEEKDAYS[weekdayIndex(date)]} ${Number(date.slice(8))}. ${Number(date.slice(5, 7))}. · ${when}`;
}

/** The school period starting closest to `start` (a test keeps only its lesson's start). */
function periodAt(start: string) {
  const m = minutes(start);
  let best = 0;
  PERIODS.forEach(([s], i) => {
    if (Math.abs(minutes(s) - m) < Math.abs(minutes(PERIODS[best][0]) - m)) best = i;
  });
  return best;
}

/** The permanent timetable of this and next week (both, for the alternating weeks). Absence reads the same. */
export const permanentKey = (monday: string) => `permanent:${monday}`;
const loadPermanent = (monday: string) => Promise.all([monday, addDays(monday, 7)].map((w) => api.permanentTimetable(w).then((t) => t.days)));

/** Subject → the groups of it you're in ("" = the whole class), from the permanent timetable. */
export function groupsOf(weeks: Day[][] | null | undefined) {
  if (!weeks) return null;
  const groups = new Map<string, Set<string>>();
  for (const l of weeks.flat().flatMap((d) => d.lessons)) {
    if (!groups.has(l.subject)) groups.set(l.subject, new Set());
    groups.get(l.subject)!.add(l.group);
  }
  return groups;
}

/**
 * A subject split into groups is in effect a different subject for each: its tests are only for that group. Tests of
 * the whole class are for everyone. Before the timetable is known, everything shows.
 */
export const forMe = (t: TestItem, groups: Map<string, Set<string>> | null) => !t.group || t.mine || !groups || !!groups.get(t.subject)?.has(t.group);

const lessonKey = (l: Lesson) => `${l.start}-${l.subject}-${l.group}`;

/** What a failed test request means for the student. */
function testError(e: unknown) {
  const code = e instanceof Error ? e.message : "";
  const known: Record<string, string> = {
    no_lesson: "Tuhle hodinu v rozvrhu ze SIS nemáš.",
    no_class: "Nejdřív si v Nastavení vyber třídu.",
    bad_date: "Test jde přidat jen na dnešek a dál.",
    rate_limited: "Na dnešek už je testů dost, zkus to zítra.",
    blocked: "Přidávání testů máš zablokované.",
  };
  return known[code] ?? "Nepodařilo se to uložit, zkus to znovu.";
}

/**
 * The class's upcoming tests, and the one place to add them: pick a day, one of your lessons that day, what it is.
 * The timetable only shows them.
 */
export function Tests({ onError }: { onError: (e: unknown) => boolean }) {
  const list = useCachedFetch<UpcomingTests>("tests:upcoming", api.upcomingTests, onError);
  const [local, setLocal] = useState<UpcomingTests | null>(null);
  useEffect(() => setLocal(null), [list.data]);
  const data = local ?? list.data;
  const [adding, setAdding] = useState(false);
  const today = todayPrague();
  const monday = mondayOf(today);
  const permanent = useCachedFetch<Day[][]>(permanentKey(monday), () => loadPermanent(monday), onError);
  const groups = groupsOf(permanent.data);

  const update = (r: UpcomingTests) => {
    cache.set("tests:upcoming", r);
    setLocal(r);
  };

  if (adding) return <AddTest onError={onError} onCancel={() => setAdding(false)} onAdded={(r) => (update(r), setAdding(false))} />;

  const tests = (data?.tests ?? []).filter((t) => t.date >= today && forMe(t, groups));
  const byDay = new Map<string, TestItem[]>();
  for (const t of tests.sort((a, b) => a.date.localeCompare(b.date) || minutes(a.start) - minutes(b.start))) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);

  return (
    <div className="screen">
      <LargeHeader
        title="Testy"
        subtitle={data?.class ? `Třída ${data.class}` : undefined}
        loading={list.loading}
        accessory={
          data?.class && (
            <button className="header-action" onClick={() => setAdding(true)}>
              + Přidat
            </button>
          )
        }
      />
      <div className="scroll">
        {list.error && <p className="banner">Testy se nepodařilo obnovit. Zobrazuji poslední uložené.</p>}
        {!data ? (
          list.error ? <Empty icon={<AlertIcon size={40} />} title="Testy se nepodařilo načíst" /> : <SkeletonList count={4} lines={2} />
        ) : !data.class ? (
          <Empty icon={<TestIcon size={40} />} title="Nejdřív vyber třídu" text="Testy se sdílí se spolužáky ze třídy. Třídu nastavíš v Nastavení." />
        ) : !byDay.size ? (
          <>
            <Empty icon={<TestIcon size={40} />} title="Nic nás nečeká" text="Až někdo ze třídy přidá test, objeví se tady i v rozvrhu u hodiny." />
            <button className="primary tests-add" onClick={() => setAdding(true)}>
              Přidat test
            </button>
          </>
        ) : (
          <>
            {[...byDay].map(([date, ts]) => (
              <Section key={date} title={testDay(date, today)}>
                {ts.map((t) => (
                  <TestRow key={t.id} test={t} onError={onError} onChange={update} />
                ))}
              </Section>
            ))}
            <p className="list-footer center">
              Testy celé třídy vidí všichni ze {data.class}, testy skupiny jen ta skupina. Když test neplatí, dej „Neplatí?“. Po třech
              hlášeních zmizí.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Runs a test request and keeps the error to show. */
function useTestAction(onError: (e: unknown) => boolean) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async <T,>(req: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError("");
    try {
      return await req();
    } catch (e) {
      if (!(e instanceof Unauthorized && onError(e))) setError(testError(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function TestRow({ test: t, onError, onChange }: { test: TestItem; onError: (e: unknown) => boolean; onChange: (r: UpcomingTests) => void }) {
  const { busy, error, run } = useTestAction(onError);
  const act = async (req: () => Promise<UpcomingTests>) => {
    const r = await run(req);
    if (r) onChange(r);
  };
  return (
    <div className={`test-row ${t.hidden || t.flagged ? "muted" : ""}`}>
      <span className="test-kind">{TEST_KINDS[t.kind]}</span>
      <span className="row-main test-main">
        <span className="test-subject">
          {t.subject}
          <small>
            {t.start}
            {` · ${periodAt(t.start)}. hodina`}
            {t.group && ` · sk. ${t.group}`}
          </small>
        </span>
        {t.note && <span className="test-note">{t.note}</span>}
        <span className="test-by">{t.mine ? "Přidáno tebou" : `Přidáno · ${t.by ?? "spolužák"}`}</span>
        {t.hidden && <span className="test-hidden">Skryto, spolužáci hlásí, že neplatí</span>}
        {error && <span className="test-error">{error}</span>}
      </span>
      {t.mine ? (
        <button className="test-act destructive" disabled={busy} onClick={() => act(() => api.deleteTest(t.id))}>
          Smazat
        </button>
      ) : (
        <button className="test-act" disabled={busy} aria-pressed={t.flagged} onClick={() => act(() => api.flagTest(t.id, !t.flagged))}>
          {t.flagged ? "Nahlášeno" : "Neplatí?"}
        </button>
      )}
    </div>
  );
}

/** Adding a test: a day (from today on), one of your own lessons that day, what it is and a short note. */
function AddTest({ onError, onCancel, onAdded }: { onError: (e: unknown) => boolean; onCancel: () => void; onAdded: (r: UpcomingTests) => void }) {
  const today = todayPrague();
  const [selected, setSelectedState] = useState(() => nextSchoolDay(today));
  const [picked, setPicked] = useState<Lesson | null>(null);
  const [kind, setKind] = useState<TestKind>("test");
  const [note, setNote] = useState("");
  const { busy, error, run } = useTestAction(onError);
  const monday = mondayOf(selected);
  const tt = useCachedFetch<TimetableResponse>(`timetable:${monday}`, () => api.timetable(monday), onError);
  const known = cache.get<UpcomingTests>("tests:upcoming")?.tests ?? [];
  const day = tt.data?.week === monday ? tt.data.days.find((d) => d.date === selected) : undefined;
  const lessons = held(day?.lessons ?? []).sort((a, b) => minutes(a.start) - minutes(b.start));
  const past = selected < today;

  const setSelected = (iso: string) => {
    setSelectedState(iso);
    setPicked(null);
  };
  const save = async () => {
    if (!picked) return;
    const r = await run(() => api.addTest({ date: selected, start: picked.start, subject: picked.subject, group: picked.group, kind, note }));
    if (r) onAdded(r);
  };

  return (
    <div className="screen">
      <LargeHeader
        title="Nový test"
        subtitle={longDate(selected)}
        loading={tt.loading}
        accessory={
          <button className="header-action quiet" onClick={onCancel}>
            Zrušit
          </button>
        }
      >
        <DayStrip monday={monday} selected={selected} onSelect={setSelected} />
      </LargeHeader>
      <div className="scroll">
        {past ? (
          <Empty icon={<CalendarOffIcon size={40} />} title="Tenhle den už byl" text="Test jde přidat na dnešek a dál." />
        ) : !day ? (
          tt.loading ? <SkeletonList count={6} lines={1} side /> : <Empty icon={<CalendarOffIcon size={40} />} title="Žádná data" />
        ) : !lessons.length ? (
          <Empty icon={<CalendarOffIcon size={40} />} title="Volno" text="Tenhle den nemáš žádnou hodinu." />
        ) : (
          <>
            <Section title="Která hodina">
              <div role="radiogroup" aria-label="Hodina">
                {lessons.map((l) => {
                  const on = !!picked && lessonKey(picked) === lessonKey(l);
                  const has = known.filter((t) => sameLesson(t, selected, l));
                  return (
                    <button key={lessonKey(l)} role="radio" aria-checked={on} className={`pick-row ${on ? "on" : ""}`} onClick={() => setPicked(l)}>
                      <span className="tt-period">{periodOf(l)}</span>
                      <span className="row-main">
                        <span className="pick-subject">{l.subject}</span>
                        <span className="row-sub">
                          {l.start}–{l.end}
                          {l.teacher && ` · ${l.teacher}`}
                          {l.group && ` · sk. ${l.group}`}
                          {has.length > 0 && ` · už má: ${has.map((t) => TEST_KINDS[t.kind].toLowerCase()).join(", ")}`}
                        </span>
                      </span>
                      <span className="pick-check" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </Section>
            <section className="list-section">
              <h2 className="list-title">Co bude</h2>
              <div className="test-form">
                <div className="test-kinds" role="radiogroup" aria-label="Co bude">
                  {(Object.keys(TEST_KINDS) as TestKind[]).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={k === kind} onClick={() => setKind(k)}>
                      {TEST_KINDS[k]}
                    </button>
                  ))}
                </div>
                <input
                  className="test-note-input"
                  value={note}
                  maxLength={TEST_NOTE_MAX}
                  placeholder="Poznámka, třeba kapitola 3–4 (nepovinné)"
                  aria-label="Poznámka"
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void save()}
                />
              </div>
            </section>
            {error && <p className="error test-form-error">{error}</p>}
            <button className="primary tests-add" disabled={!picked || busy} onClick={save}>
              {busy ? "Ukládám…" : picked ? `Přidat k ${picked.subject}` : "Vyber hodinu"}
            </button>
            <p className="list-footer center">Uvidí to všichni ze třídy, kdo tuhle hodinu mají (u skupinového předmětu jen tvoje skupina), i s tvým jménem.</p>
          </>
        )}
      </div>
    </div>
  );
}
