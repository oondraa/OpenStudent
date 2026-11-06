import { useEffect, useRef, useState } from "react";
import { cache } from "./api";

// An installed PWA stays alive in the background for hours (iPhone users rarely close apps), so a screen that's
// always mounted (Home) would keep the morning's timetable all day. Refresh when the app comes back, at most this
// often, and now and then while it stays open on screen.
const RESUME_REFRESH_MS = 60_000;
const OPEN_REFRESH_MS = 5 * 60_000;

/** Shows the cached value instantly, then refreshes it (and again whenever the app returns to the foreground).
 * `onError` returns true when it handled the error. */
export function useCachedFetch<T>(key: string | null, load: () => Promise<T>, onError: (e: unknown) => boolean) {
  const [data, setData] = useState<T | null>(() => (key ? cache.get<T>(key) : null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [resumed, setResumed] = useState(0);
  const loadedAt = useRef(0);

  useEffect(() => {
    const refresh = (after: number) => () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > after) setResumed((n) => n + 1);
    };
    // iOS standalone PWAs don't always fire visibilitychange on resume; focus and pageshow cover the misses.
    const onResume = refresh(RESUME_REFRESH_MS);
    const events = ["visibilitychange", "focus", "pageshow"] as const;
    for (const e of events) (e === "visibilitychange" ? document : window).addEventListener(e, onResume);
    const timer = setInterval(refresh(OPEN_REFRESH_MS), 30_000);
    return () => {
      for (const e of events) (e === "visibilitychange" ? document : window).removeEventListener(e, onResume);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let stale = false;
    if (key) setData(cache.get<T>(key));
    setLoading(true);
    setError(false);
    loadedAt.current = Date.now();
    load()
      .then((v) => {
        if (stale) return;
        // Usually the refresh brings what the cache already showed. Rendering it again would rebuild and repaint
        // the whole screen, often mid-way through the animation that opens it.
        if (!key || cache.set(key, v)) setData(v);
      })
      .catch((e) => {
        if (!stale && !onError(e)) setError(true);
      })
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [key, resumed]);

  return { data, loading, error };
}
