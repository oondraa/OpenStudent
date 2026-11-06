import { useCallback, useEffect, useRef, useState } from "react";
import { cache } from "./api";
import type { Point } from "../shared/transit";
import { SCHOOL } from "./tripsData";

/**
 * Where trips start, by the rules of SideQuesty:
 * - the phone's location (GPS) when it gives one,
 * - the school when the phone has no location (no signal, timeout, no GPS at all),
 * - refused: asked once more (`ask`, with why it's needed); refused again, SideQuesty are off (`locked`) until the
 *   location is allowed in the browser's site settings.
 */
export type Where =
  | { kind: "locating" }
  | { kind: "gps"; point: Point; accuracy: number }
  | { kind: "school"; point: Point; reason: string }
  | { kind: "ask"; blocked: boolean }
  | { kind: "locked"; blocked: boolean };

const DENIALS = "tripsGeoDenials";

/** Dev only: places in Hradec to test from, `?poloha=hlavak` or `?poloha=50.21,15.83` (main.tsx stores it). */
const DEV_PLACES: Record<string, [number, number]> = {
  hlavak: [50.2138, 15.8127], // Hlavní nádraží
  terminal: [50.2169, 15.8122], // Terminál HD
  velkenam: [50.2093, 15.8323], // Velké náměstí
  futurum: [50.1954, 15.8462],
  moravske: [50.198, 15.8456], // Moravské Předměstí
  novyhradec: [50.1766, 15.8558], // Nový Hradec Králové
  slezske: [50.221, 15.8592], // Slezské Předměstí, nádraží
  kukleny: [50.2069, 15.798],
};

function devPoint(): Point | null {
  if (!import.meta.env.DEV) return null;
  const v = localStorage.getItem("osis:devPoloha");
  if (!v) return null;
  const preset = DEV_PLACES[v.toLowerCase()];
  const [lat, lon] = preset ?? v.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { name: "Tady (simulace)", lat, lon } : null;
}

async function permission(): Promise<PermissionState | null> {
  try {
    return (await navigator.permissions?.query({ name: "geolocation" }))?.state ?? null;
  } catch {
    return null;
  }
}

export function useLocation() {
  const [where, setWhere] = useState<Where>({ kind: "locating" });
  const watch = useRef<number | null>(null);

  const stop = () => {
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
  };

  const refused = useCallback(async () => {
    stop();
    const denials = (cache.get<number>(DENIALS) ?? 0) + 1;
    cache.set(DENIALS, denials);
    // Once a browser blocks the site, it won't show its question again: only its settings can undo that.
    const blocked = (await permission()) === "denied";
    setWhere(denials >= 2 ? { kind: "locked", blocked } : { kind: "ask", blocked });
  }, []);

  const locate = useCallback(() => {
    stop();
    const fake = devPoint();
    if (fake) {
      setWhere({ kind: "gps", point: fake, accuracy: 10 });
      return;
    }
    // Without HTTPS (a phone on the dev server over Wi-Fi) browsers refuse the location as if the user had:
    // that's no location, not a refusal.
    if (!("geolocation" in navigator) || !isSecureContext) {
      setWhere({ kind: "school", point: SCHOOL, reason: "Tohle zařízení polohu nezná, počítám od školy." });
      return;
    }
    setWhere((w) => (w.kind === "gps" || w.kind === "school" ? w : { kind: "locating" }));
    // watchPosition: the trip starts where the phone is now, also after a walk with the screen open.
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        cache.set(DENIALS, 0);
        setWhere({ kind: "gps", point: { name: "Tady", lat: p.coords.latitude, lon: p.coords.longitude }, accuracy: p.coords.accuracy });
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) refused();
        else
          setWhere((w) =>
            w.kind === "gps" ? w : { kind: "school", point: SCHOOL, reason: "Poloha teď není k dispozici, počítám od školy." },
          );
      },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
    );
  }, [refused]);

  /** "Nepovolím" on the second question: SideQuesty turn off. */
  const decline = useCallback(async () => {
    cache.set(DENIALS, Math.max(2, cache.get<number>(DENIALS) ?? 0));
    setWhere({ kind: "locked", blocked: (await permission()) === "denied" });
  }, []);

  useEffect(() => {
    let status: PermissionStatus | null = null;
    const start = async () => {
      const state = await permission();
      const denials = cache.get<number>(DENIALS) ?? 0;
      if (state === "granted") cache.set(DENIALS, 0);
      if (state !== "granted" && denials >= 2 && !devPoint()) setWhere({ kind: "locked", blocked: state === "denied" });
      else locate();
      // Allowed later in the site settings: SideQuesty unlock by themselves.
      try {
        status = (await navigator.permissions?.query({ name: "geolocation" })) ?? null;
        if (status)
          status.onchange = () => {
            if (status?.state === "granted") {
              cache.set(DENIALS, 0);
              locate();
            }
          };
      } catch {
        /* no Permissions API (older Safari): the buttons cover it */
      }
    };
    start();
    return () => {
      stop();
      if (status) status.onchange = null;
    };
  }, [locate]);

  return { where, locate, decline };
}
