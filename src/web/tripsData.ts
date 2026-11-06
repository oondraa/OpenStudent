import { useEffect, useState } from "react";
import type { BikeStation, Point, TransitData } from "../shared/transit";
import type { Place, PlacesData } from "../shared/places";
import { cache } from "./api";
import { WalkGraph, straightWalker, type WalkData, type Walker } from "../shared/walkgraph";

/** SSAKHK, Hradecká 1151/9: where breaks and "po škole" start and where "zpátky" leads. */
export const SCHOOL: Point = { name: "Škola", lat: 50.203777, lon: 15.834439 };

// The static files are fetched once per app run; the browser's HTTP cache keeps them between runs.
let transit: Promise<TransitData> | null = null;
let places: Promise<PlacesData> | null = null;

const json = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
};

export const loadTransit = () => (transit ??= json<TransitData>("/data/transit.json").catch((e) => ((transit = null), Promise.reject(e))));
// The street network (about 1 MB, 300 kB over the wire); without it walks fall back to the straight-line estimate.
let walker: Promise<Walker> | null = null;
export const loadWalker = () =>
  (walker ??= json<WalkData>("/data/walk.json").then(
    (d) => new WalkGraph(d),
    () => ((walker = null), straightWalker),
  ));
export const loadPlaces = () => (places ??= json<PlacesData>("/data/places.json").catch((e) => ((places = null), Promise.reject(e))));

/** Static data of the screen: null while loading, an Error when it failed. */
export function useStatic<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T | Error | null>(null);
  useEffect(() => {
    let stale = false;
    load().then(
      (v) => !stale && setValue(v),
      (e) => !stale && setValue(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      stale = true;
    };
  }, [load]);
  return value;
}

// nextbike Hradec Králové publishes GBFS: station places and live counts, refreshed every minute, open to any origin.
const GBFS = "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_tl/cs";
const HK_REGION = "682";

interface GbfsInfo {
  data: { stations: { station_id: string; name: string; lat: number; lon: number; region_id?: string; rental_uris?: { web?: string; android?: string; ios?: string } }[] };
}
interface GbfsStatus {
  data: { stations: { station_id: string; num_bikes_available: number; is_renting: boolean }[] };
}

/** Live nextbike stations in Hradec; [] when the feed is down (bikes then just aren't offered). */
export function useBikes() {
  const [stations, setStations] = useState<BikeStation[] | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  useEffect(() => {
    let stale = false;
    let info: GbfsInfo | null = null;
    const load = async () => {
      try {
        info ??= await json<GbfsInfo>(`${GBFS}/station_information.json`);
        const status = await json<GbfsStatus>(`${GBFS}/station_status.json`);
        const live = new Map(status.data.stations.map((s) => [s.station_id, s]));
        const list = info.data.stations
          .filter((s) => s.region_id === HK_REGION)
          .map((s) => {
            const st = live.get(s.station_id);
            return {
              id: s.station_id,
              name: s.name,
              lat: s.lat,
              lon: s.lon,
              bikes: st?.is_renting ? st.num_bikes_available : 0,
              rentUrl: s.rental_uris?.web,
            };
          });
        if (!stale) {
          setStations(list);
          setUpdated(Date.now());
        }
      } catch {
        if (!stale) setStations((s) => s ?? []);
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, []);
  return { stations, updated };
}

// Shortcuts: the places a student goes to, each maybe under a nickname ("Fůčko"), set in Nastavení or with the
// star on a target. Until changed: the places below.
const SHORTCUTS = "sqPlaces";
export const placeKey = (p: Place) => `${p[0]}|${p[2]}|${p[3]}`;

export interface Shortcut {
  place: Place;
  /** What the student calls it; empty = the place's own name. */
  nick?: string;
}

/** The starting set: how students at SSAKHK call them. Matched by name and kind in places.json. */
const DEFAULTS: { name: string; kind: string; nick: string }[] = [
  { name: "Aupark", kind: "department_store", nick: "Aup" },
  { name: "Futurum HK", kind: "department_store", nick: "Fůčko" },
  { name: "OC Atrium", kind: "department_store", nick: "Atrium" },
  { name: "Můj obchod", kind: "convenience", nick: "Vietnamec náměstí" },
  { name: "Na hradě", kind: "restaurant", nick: "Hrad" },
];

export function defaultShortcuts(all: Place[]): Shortcut[] {
  return DEFAULTS.flatMap((d) => {
    const place = all.find((p) => p[0] === d.name && p[1] === d.kind);
    return place ? [{ place, nick: d.nick }] : [];
  });
}

/** Logos (public/brands, from the places' own websites), by name and kind. */
const LOGOS: { name: RegExp; kinds: string[]; src: string }[] = [
  { name: /aupark/i, kinds: ["mall", "department_store"], src: "/brands/aupark.png" },
  { name: /futurum/i, kinds: ["mall", "department_store"], src: "/brands/futurum.png" },
  { name: /atrium/i, kinds: ["mall", "department_store"], src: "/brands/atrium.png" },
  { name: /^na hrad[eě]$/i, kinds: ["restaurant", "pub"], src: "/brands/nahrade.png" },
];
export const logoOf = (p: Place) => LOGOS.find((l) => l.name.test(p[0]) && l.kinds.includes(p[1]))?.src ?? null;

/** The saved shortcuts (null = never changed) and ways to change them, kept in step across screens. */
export function useShortcuts() {
  const [saved, setSaved] = useState<Shortcut[] | null>(() => cache.get<Shortcut[]>(SHORTCUTS));
  useEffect(() => {
    const sync = () => setSaved(cache.get<Shortcut[]>(SHORTCUTS));
    window.addEventListener("osis:shortcuts", sync);
    return () => window.removeEventListener("osis:shortcuts", sync);
  }, []);
  const save = (list: Shortcut[]) => {
    cache.set(SHORTCUTS, list);
    setSaved(list);
    window.dispatchEvent(new Event("osis:shortcuts"));
  };
  const list = (all: Place[]) => saved ?? defaultShortcuts(all);
  const find = (p: Place, all: Place[]) => list(all).find((s) => placeKey(s.place) === placeKey(p));
  return {
    saved,
    list,
    has: (p: Place, all: Place[]) => !!find(p, all),
    /** The nickname, or the place's own name. */
    nameOf: (p: Place, all: Place[]) => find(p, all)?.nick || p[0],
    toggle: (p: Place, all: Place[]) => {
      const current = list(all);
      save(current.some((s) => placeKey(s.place) === placeKey(p)) ? current.filter((s) => placeKey(s.place) !== placeKey(p)) : [...current, { place: p }]);
    },
    rename: (p: Place, nick: string, all: Place[]) => save(list(all).map((s) => (placeKey(s.place) === placeKey(p) ? { ...s, nick: nick.trim() || undefined } : s))),
    reset: () => {
      cache.set(SHORTCUTS, null);
      setSaved(null);
      window.dispatchEvent(new Event("osis:shortcuts"));
    },
  };
}
