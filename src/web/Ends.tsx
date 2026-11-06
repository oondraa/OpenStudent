import { useMemo, useState } from "react";
import { api, cache } from "./api";
import { DayStrip, Empty, LargeHeader, Section, SkeletonList } from "./ui";
import { defaultSchoolDay, longDate, minutes, mondayOf, todayPrague } from "./time";
import { useCachedFetch } from "./useFetch";
import { useNow } from "./hooks";
import { AlertIcon, CalendarOffIcon } from "./icons";
import { SchoolLogo } from "./ClassPrompt";
import type { SchoolInfo } from "../shared/types";

interface EndsResponse {
  date: string;
  dates: string[];
  schools: { school: string; size: number; classes: Record<string, string> }[];
}

const BIN = 10;
const hh = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const fmt = (n: number) => Math.round(n).toLocaleString("cs-CZ");

/**
 * Kdo kdy končí: when the classes of every Hradec school with a public timetable finish, in waves of ten minutes.
 * The student's own school is marked; past waves fade out today.
 */
export function Ends({ onError }: { onError: (e: unknown) => boolean }) {
  const [selected, setSelected] = useState(defaultSchoolDay);
  const data = useCachedFetch<EndsResponse>(`ends:${selected}`, () => api.ends(selected), onError);
  const list = useCachedFetch<{ schools: SchoolInfo[] }>("schools", api.schools, onError);
  const mine = cache.get<{ school?: SchoolInfo | null; class?: string | null }>("me");
  const now = useNow();
  const live = selected === todayPrague();

  const byId = useMemo(() => new Map((list.data?.schools ?? []).map((s) => [s.id, s])), [list.data]);
  const waves = useMemo(() => {
    const out = new Map<number, { at: number; n: number; schools: Map<string, { classes: string[]; n: number }> }>();
    for (const s of data.data?.schools ?? []) {
      for (const [cls, end] of Object.entries(s.classes)) {
        const m = minutes(end);
        const k = Math.floor(m / BIN) * BIN;
        const w = out.get(k) ?? { at: m, n: 0, schools: new Map() };
        w.at = Math.min(w.at, m);
        w.n += s.size;
        const g = w.schools.get(s.school) ?? { classes: [], n: 0 };
        g.classes.push(cls);
        g.n += s.size;
        w.schools.set(s.school, g);
        out.set(k, w);
      }
    }
    return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([k, w]) => ({ k, ...w }));
  }, [data.data]);
  const max = Math.max(1, ...waves.map((w) => w.n));
  const peak = waves.reduce<(typeof waves)[number] | null>((a, w) => (!a || w.n > a.n ? w : a), null);
  const next = live ? waves.find((w) => w.k + BIN > now) : null;

  return (
    <div className="screen">
      <LargeHeader title="Kdo kdy končí" subtitle={longDate(selected)} loading={data.loading}>
        <DayStrip monday={mondayOf(selected)} selected={selected} onSelect={setSelected} />
      </LargeHeader>
      <div className="scroll">
        {data.error && !data.data ? (
          <Empty icon={<AlertIcon size={40} />} title="Nepodařilo se načíst" />
        ) : !data.data ? (
          <SkeletonList count={6} lines={2} />
        ) : !waves.length ? (
          <Empty icon={<CalendarOffIcon size={40} />} title="Žádné rozvrhy" text="Na tenhle den nemáme rozvrhy. Školy zveřejňují jen tento a příští týden." />
        ) : (
          <>
            <div className="ends-hero glass">
              {next ? (
                <>
                  <span className="ends-hero-label">Nejbližší konec</span>
                  <span className="ends-hero-time">{hh(next.at)}</span>
                  <span className="ends-hero-sub">
                    ~{fmt(next.n)} studentů z {next.schools.size} {next.schools.size === 1 ? "školy" : "škol"}
                  </span>
                </>
              ) : (
                peak && (
                  <>
                    <span className="ends-hero-label">{live ? "Dnes už všichni skončili. Nejvíc končilo" : "Nejvíc končí"}</span>
                    <span className="ends-hero-time">
                      {hh(peak.k)}–{hh(peak.k + BIN)}
                    </span>
                    <span className="ends-hero-sub">~{fmt(peak.n)} studentů</span>
                  </>
                )
              )}
            </div>
            <Section footer="Konec = poslední hodina celé třídy podle veřejného rozvrhu. Počty jsou odhad z kapacity škol v rejstříku MŠMT.">
              {waves.map((w) => {
                const past = live && w.k + BIN <= now;
                return (
                  <div key={w.k} className={`row ends-wave ${past ? "past" : ""} ${w === next ? "next" : ""}`}>
                    <div className="ends-time">
                      <b>{hh(w.at)}</b>
                      <small>~{fmt(w.n)}</small>
                    </div>
                    <div className="ends-main">
                      <span className="ends-bar">
                        <span style={{ transform: `scaleX(${w.n / max})` }} />
                      </span>
                      <div className="ends-schools">
                        {[...w.schools.entries()]
                          .sort((a, b) => b[1].n - a[1].n)
                          .map(([id, g]) => {
                            const s = byId.get(id);
                            const me = mine?.school?.id === id;
                            return (
                              <span key={id} className={`ends-school ${me ? "mine" : ""}`} title={g.classes.join(", ")}>
                                {s && <SchoolLogo school={s} size={22} />}
                                <span>
                                  {s?.nick ?? id}
                                  <small>
                                    {" "}
                                    · {g.classes.length > 4 ? `${g.classes.slice(0, 4).join(", ")} +${g.classes.length - 4}` : g.classes.join(", ")}
                                  </small>
                                </span>
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
