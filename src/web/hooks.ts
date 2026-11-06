import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { nowMinutesPrague } from "./time";

/** A computer: wide window and a mouse. A phone never has a fine pointer, so turned sideways it stays a phone.
 * styles.css uses the same query; keep the two in step. */
export const DESKTOP = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";

export function useDesktop() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = matchMedia(DESKTOP);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => matchMedia(DESKTOP).matches,
  );
}

export function useNow() {
  const [now, setNow] = useState(nowMinutesPrague);
  useEffect(() => {
    const t = setInterval(() => setNow(nowMinutesPrague()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Scrolls the surrounding scroll container so `target` sits near its top: opening the app on a school
 * day shows what's on now and next, while earlier lessons stay one swipe up.
 */
export function useScrollToFocus(enabled: boolean) {
  const target = useRef<HTMLElement | null>(null);
  // Layout effect: placed before the first paint, so the list doesn't show 8:00 and then jump to "now".
  useLayoutEffect(() => {
    const el = target.current;
    const scroller = el?.closest<HTMLElement>(".page, .scroll");
    if (!enabled || !el || !scroller) return;
    // Measured in layout px: a screen opening from its home tile is still scaled down on this frame.
    const box = scroller.getBoundingClientRect();
    const scale = box.height / scroller.offsetHeight || 1;
    const top = (el.getBoundingClientRect().top - box.top) / scale + scroller.scrollTop - 12;
    if (top > 0) scroller.scrollTo({ top, behavior: "instant" });
  }, [enabled]);
  return target;
}
