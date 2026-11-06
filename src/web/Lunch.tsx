import { useState } from "react";
import { api, cache, type CanteenResponse } from "./api";
import type { Meal, MenuDay } from "../worker/strava";
import { STEP, type Crowd, type CrowdDay } from "../worker/menza";
import { DayStrip, Empty, LargeHeader, SkeletonList } from "./ui";
import { useCachedFetch } from "./useFetch";
import { WEEKDAYS, addDays, longDate, minutes, mondayOf, nowMinutesPrague, todayPrague, weekdayIndex } from "./time";
import { CalendarOffIcon, UtensilsIcon } from "./icons";

const kc = (n: number) => `${n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} Kč`;
/** "2026-10-14T12:00:00" → "st 14. 10. ve 12:00" */
const deadline = (t: string) => {
  const day = t.slice(0, 10);
  return `${WEEKDAYS[weekdayIndex(day)].slice(0, 2).toLowerCase()} ${Number(day.slice(8))}. ${Number(day.slice(5, 7))}. ve ${t.slice(11, 16)}`;
};

const REFUSED: Record<string, string> = {
  locked: "Na tenhle den už objednávky skončily.",
  not_applied: "Strava změnu nepřijala. Zkontroluj objednávku ve Stravě.",
  not_saved: "Strava změnu neuložila.",
  rate_limited: "Moc změn za sebou, zkus to za minutu.",
};

/** Today until lunch is over, otherwise the next day with a menu. */
function startDay(days: MenuDay[] | undefined) {
  const today = todayPrague();
  const late = nowMinutesPrague() >= 14 * 60;
  return days?.find((d) => d.date > today || (d.date === today && !late))?.date ?? today;
}

type Pending = { day: MenuDay; meal: Meal | null; from: Meal | null };

export function Lunch({ onError }: { onError: (e: unknown) => boolean }) {
  const menu = useCachedFetch<CanteenResponse>("canteen", api.canteen, onError);
  const crowd = useCachedFetch<Crowd>("canteen-crowd", api.canteenCrowd, () => true);
  const [fresh, setFresh] = useState<CanteenResponse | null>(null);
  const data = fresh ?? menu.data;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? startDay(data?.days);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const day = data?.days.find((d) => d.date === selected);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setMsg(null);
    try {
      const next = await api.order(pending.day.date, pending.meal?.veta ?? null);
      setFresh(next);
      cache.set("canteen", next);
      cache.set("lunch", null); // the timetable's lunch card reloads
      setMsg({ ok: true, text: pending.meal ? `Objednáno: ${pending.meal.label}.` : "Oběd je odhlášený." });
    } catch (e) {
      if (!onError(e)) setMsg({ ok: false, text: REFUSED[(e as Error).message] ?? "Objednávku se nepodařilo změnit. Nic se nezměnilo, nebo to zkontroluj ve Stravě." });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const header = (
    <LargeHeader title="Obědy" subtitle={longDate(selected)} loading={menu.loading || busy}>
      <DayStrip monday={mondayOf(selected)} selected={selected} onSelect={(d) => (setPicked(d), setMsg(null))} />
    </LargeHeader>
  );

  // No school canteen known (the school doesn't use Strava, or eats somewhere we don't know): nothing to show.
  if (data && !data.connected && !data.canteen?.strava)
    return (
      <div className="screen">
        {header}
        <div className="scroll">
          <Empty
            icon={<UtensilsIcon size={40} />}
            title="Jídelníček neznáme"
            text="Tvoje škola nemá jídelnu na Strava.cz, nebo nevíme, kam chodíte na oběd."
          />
          <CrowdCard crowd={crowd.data} date={selected} />
        </div>
      </div>
    );

  const ordered = day?.meals.find((m) => m.ordered) ?? null;
  const editable = !!day?.meals.some((m) => m.editable);
  return (
    <div className="screen">
      {header}
      <div className="scroll">
        {menu.error && !fresh && <p className="banner">Obědy se nepodařilo obnovit. Zobrazuji poslední uložené.</p>}
        {msg && <p className={`banner ${msg.ok ? "ok" : "bad"}`}>{msg.text}</p>}
        {!data && menu.loading ? (
          <SkeletonList count={3} />
        ) : !day ? (
          <Empty icon={<CalendarOffIcon size={40} />} title="Na tenhle den jídelníček není" text="Strava ukazuje zhruba tři týdny dopředu." />
        ) : day.closed ? (
          <Empty icon={<CalendarOffIcon size={40} />} title="Nevaří se" text={day.closed} />
        ) : (
          <>
            {day.soup && <p className="lunch-soup">{day.soup}</p>}
            <div className="meals stagger">
              {day.meals.map((m, i) => (
                <button
                  key={m.veta || i}
                  className={`meal ${m.ordered ? "ordered" : ""}`}
                  disabled={!m.editable || m.ordered || busy}
                  aria-pressed={m.ordered}
                  onClick={() => setPending({ day, meal: m, from: ordered })}
                >
                  <span className="meal-top">
                    <span className="meal-num">{m.number ?? "–"}</span>
                    <span className="meal-label">{m.label}</span>
                    {m.ordered && <span className="meal-badge">Objednáno</span>}
                    {m.price > 0 && <span className="meal-price">{kc(m.price)}</span>}
                  </span>
                  <span className="meal-name">{m.name}</span>
                  {m.allergens.length > 0 && <span className="meal-allergens">{m.allergens.join(" · ")}</span>}
                </button>
              ))}
            </div>
            <CrowdCard crowd={crowd.data} date={day.date} />
            {data && !data.connected && (
              <p className="list-footer">
                {data.error
                  ? "Heslo do Stravy se změnilo. Propoj ji znovu v Nastavení."
                  : `Jídelníček ${data.canteen?.name ?? "jídelny"} ze Strava.cz. Propoj účet v Nastavení a objednávej obědy přímo tady.`}
              </p>
            )}
            {ordered && ordered.editable && (
              <button className="row-button destructive lunch-cancel" disabled={busy} onClick={() => setPending({ day, meal: null, from: ordered })}>
                Odhlásit oběd
              </button>
            )}
            <p className="list-footer">
              {day.deadline
                ? editable
                  ? `Objednat, změnit nebo odhlásit jde do ${deadline(day.deadline)}.`
                  : `Objednávky na tenhle den skončily ${deadline(day.deadline)}. V den výdeje jde oběd měnit jen přes burzu ve Stravě.`
                : null}
            </p>
          </>
        )}
        {data?.balance !== null && data?.balance !== undefined && (
          <p className="list-footer center">Konto ve Stravě: {kc(data.balance)}</p>
        )}
      </div>
      {pending && <ConfirmOrder p={pending} busy={busy} onConfirm={confirm} onCancel={() => setPending(null)} />}
    </div>
  );
}

const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const waitText = (min: number) => (min < 1 ? "bez fronty" : `fronta ~${Math.round(min)} min`);

/**
 * How long the queue will be over lunch: today's forecast, or a usual weekday for the other days. It's computed
 * by OpenŠtudent from the timetables of the schools that eat here, so it says "odhad", never "teď je tam".
 */
function CrowdCard({ crowd, date }: { crowd: Crowd | null; date: string }) {
  const today = date === todayPrague();
  const wd = weekdayIndex(date) + 1;
  const f: CrowdDay | undefined = (crowd?.date === date ? crowd.today : null) ?? crowd?.typical[wd];
  if (!f || !f.wait.length) return null;
  const usual = crowd?.date !== date;
  const start = minutes(f.from);
  // Only the opening hours: before and after there's nobody to serve.
  const [lo, hi] = f.open ? [minutes(f.open[0]), minutes(f.open[1])] : [start, start + f.wait.length * STEP];
  const points = f.wait.map((w, i) => ({ t: start + i * STEP, w })).filter((p) => p.t >= lo && p.t < hi);
  if (!points.length) return null;
  const top = Math.max(5, ...points.map((p) => p.w));
  const now = nowMinutesPrague();
  const nowPoint = today && !usual ? points.find((p) => now >= p.t && now < p.t + STEP) : undefined;
  const ticks = points.filter((p) => p.t % 60 === 0);
  return (
    <section className="crowd" aria-label="Fronta v jídelně">
      <div className="crowd-head">
        <span className="crowd-title">Fronta v jídelně</span>
        <span className="crowd-note">{usual ? `obvykle v ${WEEKDAYS[wd - 1].toLowerCase()}` : "odhad z rozvrhů"}</span>
      </div>
      {nowPoint && <p className="crowd-now">Teď nejspíš {waitText(nowPoint.w)}</p>}
      <div className="crowd-bars" role="img" aria-label={points.map((p) => `${hhmm(p.t)} ${waitText(p.w)}`).join(", ")}>
        {points.map((p) => (
          <span
            key={p.t}
            className={`crowd-bar ${p === nowPoint ? "now" : ""}`}
            style={{ height: `${Math.max(4, (p.w / top) * 100)}%` }}
            title={`${hhmm(p.t)}: ${waitText(p.w)}`}
          />
        ))}
      </div>
      <div className="crowd-axis" aria-hidden="true">
        {ticks.map((p) => (
          <span key={p.t} style={{ left: `${((p.t - lo) / (points.length * STEP)) * 100}%` }}>
            {hhmm(p.t)}
          </span>
        ))}
      </div>
      <p className="crowd-summary">
        {f.best && <>Nejkratší fronta {f.best.from}–{f.best.to}. </>}
        {f.peakWait && f.peakWait.min >= 1 && <>Nejhůř kolem {f.peakWait.time}, {waitText(f.peakWait.min)}.</>}
      </p>
      <p className="crowd-source">Odhad z veřejných rozvrhů škol, které sem chodí na oběd. Ne živý počet lidí.</p>
    </section>
  );
}

/** Real money: every change is spelled out and confirmed. */
function ConfirmOrder({ p, busy, onConfirm, onCancel }: { p: Pending; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const when = p.day.date === addDays(todayPrague(), 1) ? "na zítra" : `na ${WEEKDAYS[weekdayIndex(p.day.date)].toLowerCase()} ${Number(p.day.date.slice(8))}. ${Number(p.day.date.slice(5, 7))}.`;
  const title = p.meal ? (p.from ? `Změnit oběd ${when}?` : `Objednat oběd ${when}?`) : `Odhlásit oběd ${when}?`;
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="order-title">
        <h2 id="order-title" className="sheet-title">{title}</h2>
        <div className="order-summary">
          {p.from && (
            <p className={p.meal ? "order-from" : ""}>
              <b>{p.from.label}</b> {p.from.name}
            </p>
          )}
          {p.meal && (
            <p>
              {p.from && <span className="order-arrow">→ </span>}
              <b>{p.meal.label}</b> {p.meal.name} · {kc(p.meal.price)}
            </p>
          )}
        </div>
        <button className={`primary ${p.meal ? "" : "danger"}`} disabled={busy} onClick={onConfirm}>
          {busy ? "Ukládám ve Stravě…" : p.meal ? (p.from ? "Změnit" : "Objednat") : "Odhlásit"}
        </button>
        <button className="sheet-later" disabled={busy} onClick={onCancel}>
          Zrušit
        </button>
      </div>
    </div>
  );
}
