import { useSyncExternalStore } from "react";
import { cache } from "./api";
import { applyIcon } from "./appIcon";

export type Theme = "system" | "light" | "dark";
/** "new": liquid glass on a warm wallpaper, blue accent. "og": the original ink and ember. */
export type Ui = "new" | "og";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const isDark = () => {
  const t = savedTheme();
  return t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
};

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("sp-light", !dark); // splash colours (index.html), e.g. when an update shows it again
  const bar = savedUi() === "new" ? (dark ? "#2a2522" : "#b38a64") : dark ? "#0e0e10" : "#f6f3ee";
  document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute("content", bar);
  applyIcon();
}

export const savedTheme = (): Theme => cache.get<Theme>("theme") ?? "system";

export function setTheme(theme: Theme) {
  cache.set("theme", theme);
  applyTheme(theme);
  notify();
}

export const savedUi = (): Ui => cache.get<Ui>("ui") ?? "new";

export function applyUi(ui: Ui) {
  document.documentElement.setAttribute("data-ui", ui);
  applyTheme(savedTheme());
}

export function setUi(ui: Ui) {
  cache.set("ui", ui);
  applyUi(ui);
  notify();
}

export const useUi = () => useSyncExternalStore(subscribe, savedUi);

/** Re-renders when the style, theme or icon changes (Settings previews). */
export const useLook = () => useSyncExternalStore(subscribe, () => `${savedUi()}|${savedTheme()}|${cache.get<string>("icon") ?? "auto"}`);
export const lookChanged = notify;

// "Automaticky" follows the system: the icon and theme-color must follow it too.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (savedTheme() === "system") applyTheme("system");
  notify();
});
