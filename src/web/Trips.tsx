import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, type TimetableResponse } from "./api";
import { Network, options, returnOptions, distance, type BikeStation, type Journey, type Leg, type Mode, type Point } from "../shared/transit";
import { kindLabel, matchesPlace, openAt, parseHours, type Place } from "../shared/places";
import { clock, pickReturn, verdict, windows, type Window } from "../shared/trips";
import { SCHOOL, loadPlaces, loadTransit, loadWalker, useBikes, useShortcuts, useStatic } from "./tripsData";
import { PlaceIcon } from "./PlaceIcon";
import { rideKey, useLiveDelays } from "./live";
import { useLocation, type Where } from "./useLocation";
import { TripMap } from "./TripMap";
import { Empty, LargeHeader, Section } from "./ui";
import { useCachedFetch } from "./useFetch";
import { useNow } from "./hooks";
import { addDays, defaultSchoolDay, mondayOf, todayPrague, weekdayIndex } from "./time";
import { AlertIcon, SearchIcon } from "./icons";

const NO_BIKES: BikeStation[] = [];
const MODE_LABELS: Record<Mode, string> = { transit: "MHD", bike: "Nextbike", walk: "Pěšky" };
/** Always in this order, nextbike last: it's the extra, not the usual way (and never picked by itself). */
const MODE_ORDER: Mode[] = ["transit", "walk", "bike"];

type Target = Point & { place?: Place };

/** SideQuesty: somewhere in Hradec by bus, nextbike or on foot, and whether it fits before school, in a break or after. */
export function Trips({ onError }: { onError: (e: unknown) => boolean }) {
  const { where, locate, decline } = useLocation();
  if (where.kind === "ask" || where.kind === "locked") return <LocationGate where={where} onRetry={locate} onDecline={decline} />;
  return <Planner where={where} onError={onError} />;
}

function Planner({ where, onError }: { where: Where; onError: (e: unknown) => boolean }) {
  const [selected, setSelected] = useState(defaultSchoolDay);
  const [picked, setPicked] = useState<number | null>(null);
  const [custom, setCustom] = useState<number | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [full, setFull] = useState(false);
  const [pending, setPending] = useState<Target | null>(null);
  const shortcuts = useShortcuts();
  const [mode, setMode] = useState<Mode | null>(null);
  const [query, setQuery] = useState("");
  const transit = useStatic(loadTransit);
  const places = useStatic(loadPlaces);
  const walkerLoaded = useStatic(loadWalker);
  const walker = walkerLoaded instanceof Error ? null : walkerLoaded;
  const { stations } = useBikes();
  const now = useNow();
  const monday = mondayOf(selected);
  const tt = useCachedFetch<TimetableResponse>(`timetable:${monday}`, () => api.timetable(monday), onError);

  const today = todayPrague();
  const live = selected === today;
  const day = tt.data?.days.find((d) => d.date === selected) ?? null;
  const wins = useMemo(() => windows(day, live ? now : null), [day, live, now]);
  const customWin: Window | null = custom !== null ? { kind: "custom", label: clock(custom), start: custom, end: null, fromSchool: false } : null;
  const win = customWin ?? wins[Math.min(picked ?? 0, wins.length - 1)] ?? null;

  const net = useMemo(() => (transit && !(transit instanceof Error) ? walker && new Network(transit, selected, walker) : null), [transit, selected, walker]);
  const here = where.kind === "gps" || where.kind === "school" ? where.point : null;
  const origin = win?.fromSchool ? SCHOOL : here;
  // Bikes are counted now: for a trip today they're a fair guess, for another day nobody knows.
  const bikes = useMemo(() => (live && stations ? stations : NO_BIKES), [live, stations]);

  const there = useMemo(
    () => (net && walker && origin && target && win ? options(net, origin, target, win.start, bikes, walker) : []).sort((a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode)),
    [net, walker, origin, target, win?.start, bikes],
  );
  const chosen = there.find((j) => j.mode === mode) ?? there.find((j) => j.mode !== "bike") ?? null;
  const hours = useMemo(() => (target?.place ? parseHours(target.place[4]) : null), [target]);
  const weekday = weekdayIndex(selected);
  // During a lesson the way back isn't fixed: come back for the first lesson the trip allows.
  const backBy = useMemo(
    () =>
      chosen && target && win
        ? pickReturn(win, chosen, (t) => returnOptions(net, target, SCHOOL, chosen.end, t, bikes, walker ?? undefined)[0] ?? null, hours, weekday)
        : (win?.end ?? null),
    [net, walker, chosen, target, win?.start, win?.end, win?.skip, bikes, hours, weekday],
  );
  const back = useMemo(
    () => (chosen && target && backBy !== null ? returnOptions(net, target, SCHOOL, chosen.end, backBy, bikes, walker ?? undefined) : []),
    [net, walker, chosen, target, backBy, bikes],
  );
  const v = chosen && win ? verdict({ ...win, end: backBy }, chosen, back[0] ?? null, hours, weekday) : null;

  const placeList = places && !(places instanceof Error) ? places.places : [];
  // A tap on the full map only marks a point; "Jet sem" makes it the target (no trip from a stray tap).
  const pickPoint = useCallback(
    (p: { lat: number; lon: number }) => {
      // A tap right next to a known place means that place.
      const near = placeList.map((pl) => ({ pl, d: distance(p, { lat: pl[2], lon: pl[3] }) })).sort((a, b) => a.d - b.d)[0];
      setPending(near && near.d < 40 ? { name: shortcuts.nameOf(near.pl, placeList), lat: near.pl[2], lon: near.pl[3], place: near.pl } : { name: "Bod na mapě", lat: p.lat, lon: p.lon });
    },
    [placeList, shortcuts.saved],
  );
  const go = (t: Target) => {
    setTarget(t);
    setMode(null);
    setQuery("");
    setFull(false);
    setPending(null);
  };
  const pickPlace = (pl: Place) => go({ name: shortcuts.nameOf(pl, placeList), lat: pl[2], lon: pl[3], place: pl });
  const closeFull = () => {
    setFull(false);
    setPending(null);
  };

  const q = query.trim().toLocaleLowerCase("cs");
  // Searching also finds a shortcut by its nickname ("fůčko").
  const found: Place[] = q
    ? placeList.filter((p) => matchesPlace(p, q) || shortcuts.nameOf(p, placeList).toLocaleLowerCase("cs").includes(q)).slice(0, 30)
    : shortcuts.list(placeList).map((s) => s.place);

  const dataError = transit instanceof Error;
  const delays = useLiveDelays([chosen, back[0]], live, now);
  const starred = !!target?.place && shortcuts.has(target.place, placeList);
  const pickWindow = (i: number) => {
    setPicked(i);
    setCustom(null);
  };

  return (
    <div className="screen">
      <LargeHeader title="" loading={!transit || !walker || tt.loading}>
        <div className="sq-when" role="toolbar" aria-label="Kdy">
          <label className="sq-chip sq-day">
            <select
              aria-label="Den"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setPicked(null);
                setCustom(null);
              }}
            >
              {dayChoices(today, selected).map((d) => (
                <option key={d.iso} value={d.iso}>
                  {d.label}
                </option>
              ))}
            </select>
            <ChevronDown />
          </label>
          {wins.map((w, i) => (
            <button key={`${w.kind}${w.start}`} aria-pressed={custom === null && win === w} className={`sq-chip ${custom === null && win === w ? "active" : ""}`} onClick={() => pickWindow(i)}>
              {w.label} <span>{w.end !== null ? `${clock(w.start)}–${clock(w.end)}` : clock(w.start)}</span>
            </button>
          ))}
          <label className={`sq-chip ${custom !== null ? "active" : ""}`}>
            Jindy
            <input
              type="time"
              aria-label="Vlastní čas odjezdu"
              value={custom !== null ? `${String(Math.floor(custom / 60)).padStart(2, "0")}:${String(custom % 60).padStart(2, "0")}` : ""}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                setCustom(Number.isFinite(h) ? h * 60 + m : null);
              }}
            />
          </label>
        </div>
      </LargeHeader>
      <div className="scroll trips">
        <TripMap origin={origin} school={SCHOOL} target={target} stations={bikes} there={chosen} back={back[0] ?? null} onOpen={() => setFull(true)} />
        {full &&
          createPortal(
            <FullMap onClose={closeFull}>
              <TripMap origin={origin} school={SCHOOL} target={pending ?? target} stations={bikes} there={pending ? null : chosen} back={pending ? null : (back[0] ?? null)} onPick={pickPoint} />
              {pending ? (
                <div className="sq-full-sheet">
                  <span className="sq-target-text">
                    <b>{pending.name}</b>
                    <small>{pending.place ? `${kindLabel(pending.place[1])} · ${hoursToday(pending.place, weekdayIndex(selected))}` : "Klepnutím jinam bod posuneš"}</small>
                  </span>
                  <button className="primary sq-go" onClick={() => go(pending)}>
                    Jet sem
                  </button>
                </div>
              ) : (
                <p className="sq-full-hint">Klepni, kam chceš jet</p>
              )}
            </FullMap>,
            document.body,
          )}
        {where.kind === "school" && !win?.fromSchool && <p className="trip-note">{where.reason}</p>}
        {where.kind === "locating" && !win?.fromSchool && <p className="trip-note">Zjišťuji polohu…</p>}

        {dataError ? (
          <Empty icon={<AlertIcon size={40} />} title="Jízdní řády se nepodařilo načíst" text="Zkus to znovu za chvíli." />
        ) : !target ? (
          <>
            <label className="search">
              <SearchIcon size={20} />
              <input type="search" placeholder="Kam? Obchod, kavárna, kino…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {found.length > 0 && (
              <Section
                title={q ? "Nalezeno" : "Moje místa"}
                footer={q ? undefined : "Svoje místa si nastavíš hvězdičkou u cíle nebo v Nastavení. Jinam: otevři mapu."}
              >
                {found.map((p) => {
                  const name = shortcuts.nameOf(p, placeList);
                  return (
                  <button key={`${p[0]}${p[2]}${p[3]}`} className="row trip-place" onClick={() => pickPlace(p)}>
                    <PlaceIcon place={p} />
                    <span className="row-main">
                      <span className="row-title">{name}</span>
                      <span className="row-sub">
                        {name !== p[0] ? `${p[0]} · ` : ""}
                        {kindLabel(p[1])}
                        {here ? ` · ${km(distance(here, { lat: p[2], lon: p[3] }))}` : ""}
                      </span>
                    </span>
                    <HoursPill place={p} weekday={weekdayIndex(selected)} at={win?.start ?? now} />
                  </button>
                  );
                })}
              </Section>
            )}
            {places instanceof Error && <p className="list-footer">Seznam obchodů se nepodařilo načíst, cíl vyber v mapě.</p>}
          </>
        ) : (
          <section className={`sq-card ${v?.level ?? ""}`}>
            <header className="sq-target">
              {target.place && <PlaceIcon place={target.place} />}
              <span className="sq-target-text">
                <b>{target.name}</b>
                <small>{targetSub(target, weekdayIndex(selected))}</small>
              </span>
              <button
                className={`sq-star ${starred ? "on" : ""}`}
                aria-pressed={starred}
                aria-label="Mezi moje místa"
                onClick={() => {
                  // A point on the map becomes a place of its own, renamed in Nastavení.
                  const place: Place = target.place ?? [CUSTOM_NAME, "custom", Math.round(target.lat * 1e6) / 1e6, Math.round(target.lon * 1e6) / 1e6, null];
                  shortcuts.toggle(place, placeList);
                  if (!target.place) setTarget({ ...target, name: CUSTOM_NAME, place });
                }}
              >
                {starred ? "★" : "☆"}
              </button>
              <button className="sq-close" aria-label="Zrušit cíl" onClick={() => setTarget(null)}>
                ×
              </button>
            </header>

            {!win ? (
              <p className="sq-empty">Na tenhle den není kdy. Vyber jiný den nebo čas v „Jindy“.</p>
            ) : !origin || !chosen ? (
              <p className="sq-empty">{!origin ? "Čekám na polohu…" : "Počítám cestu…"}</p>
            ) : (
              <>
                {v && (
                  <div className="sq-verdict" role="status">
                    <p className="sq-verdict-title">
                      <span aria-hidden>{v.level === "ok" ? "✓" : v.level === "tight" ? "!" : "✕"}</span> {v.title}
                    </p>
                    <p className="sq-verdict-text">{v.text}</p>
                  </div>
                )}

                <div className="sq-modes" role="tablist" aria-label="Čím">
                  {there.map((j) => (
                    <button key={j.mode} role="tab" aria-selected={chosen === j} className={`sq-mode ${chosen === j ? "active" : ""}`} onClick={() => setMode(j.mode)}>
                      <span className="sq-mode-name">{MODE_LABELS[j.mode]}</span>
                      <span className="sq-mode-min">{j.end - j.start} min</span>
                      <span className="sq-mode-at">tam {clock(j.end)}</span>
                    </button>
                  ))}
                </div>

                <p className="sq-sub">
                  {win.fromSchool ? "Ze školy" : where.kind === "gps" ? "Odsud" : "Od školy"} · vyraz v <b>{clock(chosen.start)}</b>
                </p>
                <Legs journey={chosen} delays={delays} />

                {backBy !== null && (
                  <div className="sq-back">
                    <p className="sq-back-title">Zpátky do školy do {clock(backBy)}</p>
                    {back.length ? (
                      <>
                        <div className="sq-back-list">
                          {back.map((j) => (
                            <span key={j.mode} className="sq-back-item">
                              {MODE_LABELS[j.mode]} <b>nejpozději {clock(j.start)}</b>
                            </span>
                          ))}
                        </div>
                        <details className="sq-details">
                          <summary>Cesta zpátky ({MODE_LABELS[back[0].mode]})</summary>
                          <Legs journey={back[0]} delays={delays} />
                        </details>
                      </>
                    ) : (
                      <p className="sq-verdict-text">Do začátku hodiny se odtamtud zpátky nedostaneš.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        <p className="list-footer trip-credits">
          Jízdní řády MHD, regionálních autobusů a vlaků z celostátního systému CIS JŘ (data platná k {transit && !(transit instanceof Error) ? new Date(transit.generated).toLocaleDateString("cs-CZ") : "…"}). Zpoždění živě z map DPMHK a IREDO, jen pro dnešek.
          Kola nextbike živě{live ? "" : " (jen pro dnešek)"}. Obchody, otevírací doby a pěší trasy po ulicích a chodnících z OpenStreetMap.
        </p>
      </div>
    </div>
  );
}

const SHORT_DAYS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

/** The school days of the next two weeks for the day picker (and the chosen one, wherever it is). */
function dayChoices(today: string, selected: string) {
  const days: string[] = [];
  for (let i = 0; i < 15; i++) {
    const d = addDays(today, i);
    if (weekdayIndex(d) < 5) days.push(d);
  }
  if (!days.includes(selected)) days.unshift(selected);
  return days.map((iso) => {
    const [, m, d] = iso.split("-").map(Number);
    const label = iso === today ? "Dnes" : iso === addDays(today, 1) ? "Zítra" : `${SHORT_DAYS[weekdayIndex(iso)]} ${d}. ${m}.`;
    return { iso, label };
  });
}

/** The map over the whole screen, where taps pick a target. Escape or × closes it. */
function FullMap({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="sq-full" role="dialog" aria-modal="true" aria-label="Mapa">
      {children}
      <button className="sq-full-close glass" aria-label="Zavřít mapu" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A train is known by its number, a regional bus by its six-digit line: say which it is. */
function lineLabel(l: Extract<Leg, { kind: "ride" }>) {
  return l.vehicle === "train" ? `vlak ${l.line}` : l.line;
}

function km(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

/** "+3 min" from the live map, "včas" when on time; nothing when unknown. */
function Delay({ min }: { min: number | undefined }) {
  if (min === undefined) return null;
  if (min <= 0) return <span className="sq-delay ok">{min < 0 ? `${min} min` : "včas"}</span>;
  return <span className={`sq-delay ${min >= 3 ? "late" : "slight"}`}>+{min} min</span>;
}

const stopsWord = (n: number) => (n === 1 ? "zastávka" : n < 5 ? "zastávky" : "zastávek");

/** The journey step by step: a time, a coloured line (dotted on foot) and what to do. */
function Legs({ journey, delays }: { journey: Journey; delays: Record<string, number> }) {
  return (
    <ol className="sq-legs">
      {journey.legs.map((l, i) => (
        <li key={i} className={`sq-leg ${l.kind} ${l.kind === "ride" ? l.vehicle : ""}`}>
          <span className="sq-leg-time">{clock(l.start)}</span>
          <span className="sq-leg-body">
            {l.kind === "walk" && (
              <>
                <span>
                  Pěšky na <b>{l.to.name}</b>
                </span>
                <small>
                  {km(l.meters)} · {l.end - l.start} min
                </small>
              </>
            )}
            {l.kind === "ride" && (
              <>
                <span>
                  <span className={`trip-line ${l.vehicle}`}>{lineLabel(l)}</span> směr {l.headsign}
                  <Delay min={delays[rideKey(l)]} />
                </span>
                <small>
                  Nastup na <b>{l.from.name}</b>, vystup na <b>{l.to.name}</b> v {clock(l.end)} · {l.stops.length - 1} {stopsWord(l.stops.length - 1)}
                </small>
              </>
            )}
            {l.kind === "bike" && (
              <>
                <span>
                  Nextbike na <b>{l.to.name}</b>
                </span>
                <small>
                  Půjč si kolo na stanici {l.from.name} · {km(l.meters)} · {l.end - l.start} min
                  {l.rentUrl && (
                    <>
                      {" · "}
                      <a href={l.rentUrl} target="_blank" rel="noopener">
                        půjčit
                      </a>
                    </>
                  )}
                </small>
              </>
            )}
          </span>
        </li>
      ))}
      <li className="sq-leg end">
        <span className="sq-leg-time">{clock(journey.end)}</span>
        <span className="sq-leg-body">
          <span>
            <b>{journey.legs[journey.legs.length - 1].to.name}</b>
          </span>
        </span>
      </li>
    </ol>
  );
}

const CUSTOM_NAME = "Vlastní místo";

/** Under the target's name: its real name (when nicknamed), kind and today's hours. */
function targetSub(t: Target, weekday: number) {
  if (!t.place) return "Vybráno v mapě";
  if (t.place[1] === "custom") return t.name !== t.place[0] ? "Vlastní místo" : "Přejmenuješ v Nastavení → Moje místa";
  return `${t.name !== t.place[0] ? `${t.place[0]} · ` : ""}${kindLabel(t.place[1])} · ${hoursToday(t.place, weekday)}`;
}

function hoursToday(place: Place, weekday: number) {
  const week = parseHours(place[4]);
  if (!week) return place[4] ? "otevírací doba nejasná" : "otevírací doba neznámá";
  const today = week[weekday];
  return today.length ? `dnes ${today.map(([a, b]) => `${clock(a)}–${clock(b)}`).join(", ")}` : "dnes zavřeno";
}

function HoursPill({ place, weekday, at }: { place: Place; weekday: number; at: number }) {
  const week = parseHours(place[4]);
  if (!week) return null;
  const s = openAt(week, weekday, at);
  return <span className={`pill-status ${s.open ? "free" : "busy"}`}>{s.open ? `do ${clock(s.closes)}` : "zavřeno"}</span>;
}

/** Location refused: asked once more; refused again, SideQuesty are off. */
function LocationGate({ where, onRetry, onDecline }: { where: Extract<Where, { kind: "ask" | "locked" }>; onRetry: () => void; onDecline: () => void }) {
  const howTo = "V prohlížeči klepni na ikonu vedle adresy (zámek nebo nastavení webu) → Oprávnění → Poloha → Povolit. V nainstalované aplikaci: Nastavení telefonu → Aplikace → prohlížeč → Oprávnění → Poloha.";
  if (where.kind === "ask")
    return (
      <div className="screen">
        <LargeHeader title="SideQuesty" />
        <div className="scroll">
          <div className="trip-gate">
            <p className="empty-title">SideQuesty potřebují tvoji polohu</p>
            <p className="empty-text">
              Cestu počítají od místa, kde jsi, a podle toho říkají, jestli to stihneš. Poloha zůstává v telefonu, nikam se neposílá.
            </p>
            {where.blocked && <p className="empty-text">Prohlížeč má polohu pro tenhle web zakázanou. {howTo}</p>}
            <button className="primary" onClick={onRetry}>
              {where.blocked ? "Zkusit znovu" : "Povolit polohu"}
            </button>
            <button className="row-button trip-decline" onClick={onDecline}>
              Nepovolím
            </button>
          </div>
        </div>
      </div>
    );
  return (
    <div className="screen">
      <LargeHeader title="SideQuesty" />
      <div className="scroll">
        <div className="trip-gate">
          <p className="empty-title">SideQuesty jsou vypnuté</p>
          <p className="empty-text">Bez polohy nemají z čeho počítat. Jakmile ji povolíš, zapnou se samy.</p>
          {where.blocked && <p className="empty-text">{howTo}</p>}
          <button className="row-button" onClick={onRetry}>
            Zkusit znovu
          </button>
        </div>
      </div>
    </div>
  );
}
