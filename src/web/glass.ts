import { reducedMotion } from "./spring";

/**
 * Liquid glass, the part CSS can't do alone (the material itself lives in styles.css, `.glass`): a pressed `.glass`
 * lights up from the point under the finger (CSS reads --gx/--gy).
 *
 * There used to be edge refraction too, an SVG displacement filter inside backdrop-filter (Chromium only). It went:
 * behind every glass element there's only a smooth gradient, so it changed no visible pixel, while on Android it
 * cost a filter per tile on every frame of the screen animations.
 */
export function initGlass() {
  addEventListener(
    "pointerdown",
    (e) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(".glass");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--gx", `${e.clientX - r.left}px`);
      el.style.setProperty("--gy", `${e.clientY - r.top}px`);
    },
    { capture: true, passive: true },
  );
}

/**
 * A selection pill on the move turns briefly into clear glass and swells, like a lens sliding over the labels,
 * then settles back into its solid colour.
 */
export function lift(el: HTMLElement | null) {
  if (!el || reducedMotion()) return;
  el.classList.add("lifted");
  el.animate([{ scale: "1" }, { scale: "1.14 1.2", offset: 0.35 }, { scale: "1" }], { duration: 460, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
  clearTimeout(Number(el.dataset.liftTimer));
  el.dataset.liftTimer = String(setTimeout(() => el.classList.remove("lifted"), 260));
}
