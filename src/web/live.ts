import { useEffect, useState } from "react";
import { api } from "./api";
import type { Journey, Leg } from "../shared/transit";

type Ride = Extract<Leg, { kind: "ride" }>;

/** Which ride a delay belongs to. */
export const rideKey = (l: Ride) => `${l.line}|${l.start}|${l.from.lat},${l.from.lon}`;

/** Rides worth asking about: today, from a little ago (it may be running late) to two hours ahead. */
const AHEAD = 120;
const BEHIND = 30;
const REFRESH = 30_000;

/**
 * Live delays (minutes) of the rides in these journeys, when they're today and soon. Regional buses and trains
 * by their IREDO id; city buses from the live departure board of the stop they're boarded at. Unknown = absent.
 */
export function useLiveDelays(journeys: (Journey | null | undefined)[], today: boolean, now: number) {
  const rides = journeys
    .flatMap((j) => j?.legs ?? [])
    .filter((l): l is Ride => l.kind === "ride" && today && l.start >= now - BEHIND && l.start <= now + AHEAD);
  const wanted = rides.map(rideKey).sort().join(";");
  const [delays, setDelays] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!rides.length) return;
    let stale = false;
    const load = async () => {
      const out: Record<string, number> = {};
      const regional = rides.filter((r) => r.liveId);
      const city = rides.filter((r) => r.vehicle === "bus" || r.vehicle === "trolleybus");
      const tasks: Promise<void>[] = [];
      if (regional.length)
        tasks.push(
          api.liveIredo().then(({ delays }) => {
            for (const r of regional) if (r.liveId && delays[r.liveId] !== undefined) out[rideKey(r)] = delays[r.liveId];
          }),
        );
      // One board per stop, however many rides leave from it.
      const stops = new Map<string, Ride[]>();
      for (const r of city) stops.set(`${r.from.lat},${r.from.lon}`, [...(stops.get(`${r.from.lat},${r.from.lon}`) ?? []), r]);
      for (const group of stops.values())
        tasks.push(
          api.liveMhd(group[0].from.lat, group[0].from.lon).then(({ departures }) => {
            for (const r of group) {
              const d = departures.find((x) => x.line === r.line && x.plan % 1440 === r.start % 1440);
              if (d) out[rideKey(r)] = Math.round(d.delay / 60);
            }
          }),
        );
      // A feed that's down just leaves its rides without a delay.
      await Promise.allSettled(tasks);
      if (!stale) setDelays(out);
    };
    load();
    const timer = setInterval(load, REFRESH);
    return () => {
      stale = true;
      clearInterval(timer);
    };
    // `wanted` names the rides; the array itself is new on every render.
  }, [wanted]);

  return delays;
}
