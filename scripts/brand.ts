// Generates the brand assets from the rebrand spec (Ember/Ink/Paper, Sora + JetBrains Mono).
// Text is converted to outlines, so the SVGs render the same everywhere without the fonts.
//   npx tsx scripts/brand.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";

export const EMBER = "#FF5A1F";
export const INK = "#0E0E10";
export const PAPER = "#F6F3EE";

const load = (f: string) => {
  const buf = readFileSync(`brand/fonts/${f}`);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const SORA_300 = load("sora-300.ttf");
const SORA_600 = load("sora-600.ttf");
const SORA_800 = load("sora-800.ttf");
const MONO = load("jbmono-500.ttf");

interface Run {
  text: string;
  font: opentype.Font;
  fill: string;
}

// Own serializer: opentype.js toPathData() emits "NaN" for some coordinates (it ate parts of "S" and "R").
const num = (v: number) => String(Math.round(v * 100) / 100);
function pathData(p: opentype.Path) {
  return p.commands
    .map((c) => {
      if (c.type === "M" || c.type === "L") return `${c.type}${num(c.x)} ${num(c.y)}`;
      if (c.type === "Q") return `Q${num(c.x1)} ${num(c.y1)} ${num(c.x)} ${num(c.y)}`;
      if (c.type === "C") return `C${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`;
      return "Z";
    })
    .join("");
}

/** Lays out runs on one baseline with letter spacing in em; returns SVG paths and the total width. */
function line(runs: Run[], size: number, x: number, y: number, tracking = 0) {
  let cursor = x;
  const paths: string[] = [];
  for (const r of runs) {
    const scale = size / r.font.unitsPerEm;
    const glyphs = r.font.stringToGlyphs(r.text);
    let d = "";
    glyphs.forEach((g, i) => {
      d += pathData(g.getPath(cursor, y, size));
      cursor += (g.advanceWidth ?? 0) * scale + tracking * size;
      if (glyphs[i + 1]) cursor += r.font.getKerningValue(g, glyphs[i + 1]) * scale;
    });
    paths.push(`<path fill="${r.fill}" d="${d}"/>`);
  }
  return { svg: paths.join(""), width: cursor - x - tracking * size };
}

const svgDoc = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** "Open / SIS" app tile on a 512 grid. `inset` shrinks the content into the maskable safe zone. */
function tile({ bg, open, sis, radius, inset = 1 }: { bg: string; open: string; sis: string; radius: number; inset?: number }) {
  const S = 512;
  const pad = 72;
  const l1 = line([{ text: "Open", font: SORA_300, fill: open }], 120, pad, 236, -0.03);
  const l2 = line([{ text: "SIS", font: SORA_800, fill: sis }], 144, pad - 4, 364, -0.03);
  const c = (1 - inset) * (S / 2);
  return svgDoc(S, S, `<rect width="${S}" height="${S}" rx="${radius}" fill="${bg}"/><g transform="translate(${c} ${c}) scale(${inset})">${l1.svg}${l2.svg}</g>`);
}

function wordmark(open: string, sisakhk: string) {
  const size = 96;
  const { svg, width } = line(
    [
      { text: "Open", font: SORA_300, fill: open },
      { text: "SISAKHK", font: SORA_800, fill: sisakhk },
    ],
    size,
    0,
    size * 0.9,
    -0.03,
  );
  return svgDoc(Math.ceil(width), Math.ceil(size * 1.15), svg);
}

function socialPreview() {
  const W = 1280;
  const H = 640;
  const dots = `<pattern id="d" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="16" cy="16" r="1.9" fill="#2A2826"/></pattern>`;
  const title = line(
    [
      { text: "Open", font: SORA_300, fill: PAPER },
      { text: "SISAKHK", font: SORA_800, fill: EMBER },
    ],
    102,
    92,
    214,
    -0.035,
  );
  // Each tagline word starts with an Ember initial that spells S-I-S-A-K-H-K.
  const tag = (words: string[], y: number) => {
    const runs: Run[] = [];
    words.forEach((w, i) => {
      runs.push({ text: w[0], font: SORA_600, fill: EMBER }, { text: w.slice(1) + (i < words.length - 1 ? " " : ""), font: SORA_600, fill: "#C9C4BA" });
    });
    return line(runs, 30, 92, y, 0.06).svg;
  };
  const icon = tile({ bg: EMBER, open: INK, sis: INK, radius: 120 }).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  const foot = (text: string, fill: string, right = false) => {
    const probe = line([{ text, font: MONO, fill }], 21, 0, 0).width;
    return line([{ text, font: MONO, fill }], 21, right ? W - 92 - probe : 92, 560).svg;
  };
  return svgDoc(
    W,
    H,
    `<defs>${dots}</defs><rect width="${W}" height="${H}" fill="${INK}"/><rect width="${W}" height="${H}" fill="url(#d)"/>` +
      `<rect width="14" height="${H}" fill="${EMBER}"/>` +
      `<g transform="translate(${W - 84 - 228} 84) rotate(6 114 114) scale(${228 / 512})">${icon}</g>` +
      title.svg +
      `<rect x="92" y="256" width="84" height="5" rx="2.5" fill="${EMBER}"/>` +
      tag(["ŠKOLNÍ", "INFORMAČNÍ", "SYSTÉM"], 336) +
      tag(["APLIKOVANÉ", "KYBERNETIKY"], 380) +
      tag(["HRADCI", "KRÁLOVÉ"], 424) +
      foot("rozvrh · známky · absence · gym", "#8F8A81") +
      foot("github.com/oondraa/OpenSISAKHK", EMBER, true),
  );
}

const png = (svg: string, width: number) => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();

mkdirSync("brand", { recursive: true });
const appIcon = tile({ bg: INK, open: PAPER, sis: EMBER, radius: 120 });
const fullBleed = tile({ bg: INK, open: PAPER, sis: EMBER, radius: 0 });
const maskable = tile({ bg: INK, open: PAPER, sis: EMBER, radius: 0, inset: 0.8 });
const files: Record<string, string | Uint8Array> = {
  "public/icon.svg": appIcon,
  "public/icon-192.png": png(appIcon, 192),
  "public/icon-512.png": png(appIcon, 512),
  "public/icon-maskable-512.png": png(maskable, 512),
  "public/apple-touch-icon.png": png(fullBleed, 180), // iOS rounds the corners itself
  "public/favicon-32.png": png(appIcon, 32),
  "brand/icon-ember.svg": tile({ bg: EMBER, open: INK, sis: INK, radius: 120 }),
  "brand/wordmark-light.svg": wordmark(INK, INK),
  "brand/wordmark-dark.svg": wordmark(PAPER, EMBER),
  "brand/social-preview.png": png(socialPreview(), 1280),
};
for (const [path, data] of Object.entries(files)) writeFileSync(path, data);
console.log(Object.keys(files).join("\n"));
