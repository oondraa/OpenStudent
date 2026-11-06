import logo from "../../public/icon.svg?raw";
import { cache } from "./api";
import { isDark, savedUi } from "./theme";

/**
 * The app icon in every look from the design: the original ink/paper pair and Liquid Glass in orange or blue, each
 * light, dark, tinted and clear. Built from the letter paths of public/icon.svg, so "Open SIS" is drawn the same.
 */
export type IconId =
  | "og-dark" | "og-light"
  | "orange-light" | "orange-dark" | "orange-tinted" | "orange-clear"
  | "blue-light" | "blue-dark" | "blue-tinted" | "blue-clear";
export type IconChoice = IconId | "auto";

interface Look {
  label: string;
  /** background: one colour, or a top-left → bottom-right gradient */
  bg: string | [string, string];
  open: string;
  sis: string;
  /** hairline round the edge, so a light icon doesn't melt into a light page */
  ring?: string;
}

const OR = "#FF5C1A";
const BL = "#0088FF";
const glass = (sis: string): Record<"light" | "dark" | "tinted" | "clear", Look> => ({
  light: { label: "Světlá", bg: ["#FFFFFF", "#ECECF0"], open: "#000000", sis, ring: "#DBDBDB" },
  dark: { label: "Tmavá", bg: ["#2C2C30", "#121214"], open: "#F5F5F5", sis },
  tinted: { label: "Tónovaná", bg: ["#28282A", "#101012"], open: "rgba(255,255,255,0.55)", sis: "#EBEBEB" },
  clear: { label: "Průhledná", bg: "rgba(255,255,255,0.28)", open: "rgba(255,255,255,0.75)", sis: "#FFFFFF", ring: "rgba(255,255,255,0.6)" },
});
const o = glass(OR);
const b = glass(BL);

export const ICONS: Record<IconId, Look> = {
  "og-dark": { label: "Výchozí", bg: "#101012", open: "#F5F5F5", sis: OR },
  "og-light": { label: "Světlá", bg: "#FFFFFF", open: "#101012", sis: OR, ring: "#DBDBDB" },
  "orange-light": o.light, "orange-dark": o.dark, "orange-tinted": o.tinted, "orange-clear": o.clear,
  "blue-light": b.light, "blue-dark": b.dark, "blue-tinted": b.tinted, "blue-clear": b.clear,
};

export const ICON_GROUPS: { title: string; ids: IconId[] }[] = [
  { title: "Původní", ids: ["og-dark", "og-light"] },
  { title: "Liquid Glass · oranžová", ids: ["orange-light", "orange-dark", "orange-tinted", "orange-clear"] },
  { title: "Liquid Glass · modrá", ids: ["blue-light", "blue-dark", "blue-tinted", "blue-clear"] },
];

const [OPEN_PATH, SIS_PATH] = [...logo.matchAll(/<path fill="[^"]+" d="([^"]+)"/g)].map((m) => m[1]);

export const savedIcon = (): IconChoice => cache.get<IconChoice>("icon") ?? "auto";

/** "Automaticky": the original icon with the original look; with the new one, light or dark glass by the theme. */
export function resolveIcon(choice: IconChoice = savedIcon()): IconId {
  if (choice !== "auto") return choice;
  if (savedUi() === "og") return "og-dark";
  return isDark() ? "orange-dark" : "orange-light";
}

export function iconSvg(id: IconId) {
  const l = ICONS[id];
  const fill = typeof l.bg === "string" ? l.bg : "url(#bg)";
  const grad = typeof l.bg === "string" ? "" : `<defs><linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${l.bg[0]}"/><stop offset="1" stop-color="${l.bg[1]}"/></linearGradient></defs>`;
  const ring = l.ring ? `<rect x="2" y="2" width="508" height="508" rx="118" fill="none" stroke="${l.ring}" stroke-width="4"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${grad}<rect width="512" height="512" rx="120" fill="${fill}"/>${ring}<path fill="${l.open}" d="${OPEN_PATH}"/><path fill="${l.sis}" d="${SIS_PATH}"/></svg>`;
}

export const iconUrl = (id: IconId) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(id))}`;

/** iOS reads the touch icon when the app is added to the home screen and wants a PNG. */
function pngUrl(id: IconId, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d")!.drawImage(img, 0, 0, size, size);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = iconUrl(id);
  });
}

let shown: IconId | null = null;

/** Tab icon and the icon a new home-screen shortcut gets. An already installed app keeps the icon it was added with. */
export function applyIcon() {
  const id = resolveIcon();
  if (id === shown) return;
  shown = id;
  for (const el of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')) el.remove();
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = iconUrl(id);
  document.head.appendChild(link);
  pngUrl(id, 180)
    .then((url) => {
      if (shown === id) document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.setAttribute("href", url);
    })
    .catch(() => {});
}

export function setIcon(choice: IconChoice) {
  cache.set("icon", choice);
  applyIcon();
}
