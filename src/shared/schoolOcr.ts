// Reads the school-wide timetable JPGs (/TimeTable/{PO..PA}{1,2}.jpg).
// The images are rendered by the same program every time: the grid sits at fixed pixel
// positions and the text is a bitmap font, so a tiny template matcher beats a real OCR.

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface Cell {
  /** Class row label, e.g. "T3". */
  cls: string;
  period: number;
  /** Sub-column 0–2 (lesson groups). */
  slot: number;
  subject: string;
  teacher: string;
  room: string;
  /** Pink background = changed/substituted. */
  changed: boolean;
}

// Left edges of the 36 sub-columns (12 periods × 3) plus the right edge.
const COLS = [
  39, 70, 100, 129, 160, 190, 219, 250, 280, 309, 340, 370, 399, 430, 460, 489, 520, 550, 579, 610, 640, 669, 700, 730,
  759, 790, 820, 849, 880, 910, 939, 970, 1000, 1029, 1060, 1090, 1119,
];
const ROW_TOP = 100;
const ROW_HEIGHT = 44;
const LINE_OFFSETS = [4, 16, 28];
const GLYPH_H = 9;
const DARK = 130;

// Row order printed on every image so far; checked against the image size below.
export const CLASSES = ["G1", "T1", "G2", "T2", "I2", "G3", "T3", "I3", "G4", "T4", "I4"];

export const PERIODS = [
  ["7:00", "7:45"], ["7:50", "8:35"], ["8:45", "9:30"], ["9:45", "10:30"], ["10:45", "11:30"], ["11:45", "12:30"],
  ["12:45", "13:30"], ["13:45", "14:30"], ["14:45", "15:30"], ["15:45", "16:30"], ["16:45", "17:30"], ["17:45", "18:30"],
] as const;

// prettier-ignore
const FONT_SRC: [string, string][] = [
  ["0", ".###. #...# #...# #...# #...# #...# #...# #...# .###."],
  ["1", "..#. ###. ..#. ..#. ..#. ..#. ..#. ..#. ####"],
  ["1", "..#.. ###.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#.. #####"],
  ["1", ".#. ##. .#. .#. .#. .#. .#. .#. ###"],
  ["2", "####. ....# ....# ....# ...#. ..#.. .#... #.... #####"],
  ["2", "####.. ....#. ....#. ....#. ...#.. ..##.. .#.... #..... ######"],
  ["3", "####. ....# ....# ....# ..##. ....# ....# ....# ####."],
  ["3", ".####. .....# .....# .....# ...##. .....# .....# #....# .####."],
  ["4", "....#. ...##. ..#.#. .#..#. #...#. ###### ....#. ....#. ....#."],
  ["4", "...#. ..##. .#.#. #..#. ...#. ##### ...#. ...#. ...#."],
  ["5", "##### #.... #.... ####. ....# ....# ....# ...## ####."],
  ["6", "..##. .#... #.... ####. #...# #...# #...# #...# .###."],
  ["6", "..### .#... #.... ####. #...# #...# #...# #...# .###."],
  ["7", "##### ....# ...#. ...#. ..##. ..#.. .#... .#... #...."],
  ["8", ".###. #...# #...# ##..# .###. #...# #...# #...# .###."],
  ["9", ".###. #..## #...# #...# #...# .#### ....# ...#. .##.."],
  ["A", "...#... ..###.. ..#.#.. ..#.#.. .#...#. .#...#. .#####. ......# #.....#"],
  ["A", "..#... .###.. .#.#.. .#.#.. #...#. #...#. #####. .....# .....#"],
  ["B", "####. #...# #...# #...# ####. #...# #...# #...# ####."],
  ["C", "..#### .#...# #..... #..... #..... #..... #..... .#...# ..###."],
  ["D", "####.. #...#. #....# #....# #....# #....# #....# #...#. ####.."],
  ["E", "##### #.... #.... #.... ##### #.... #.... #.... #####"],
  ["E", "###### #..... #..... #..... #####. #..... #..... #..... ######"],
  ["F", "##### #.... #.... #.... ##### #.... #.... #.... #...."],
  ["G", "..#### .#.... #..... #..... #..### #....# #....# .#...# ..###."],
  ["H", "#....# #....# #....# #....# ###### #....# #....# #....# #....#"],
  ["I", "### .#. .#. .#. .#. .#. .#. .#. ###"],
  ["J", ".### ...# ...# ...# ...# ...# ...# ...# ###."],
  ["K", "#...## #..##. #..#.. #.#... ###... #.##.. #..#.. #...#. #...##"],
  ["L", "#.... #.... #.... #.... #.... #.... #.... #.... #####"],
  ["M", "##...## ##...## ##...## #.#.#.# #.#.#.# #..#..# #..#..# #.....# #.....#"],
  ["N", "##...# ##...# #.#..# #.#..# #..#.# #..#.# #...## #...## #....#"],
  ["O", "..###.. .#...#. #.....# #.....# #.....# #.....# #.....# .#...#. ..###.."],
  ["P", "####. #...# #...# #...# #...# ####. #.... #.... #...."],
  ["R", "####.. #...#. #...#. #...#. ####.. #..#.. #...#. #...#. #....#"],
  ["S", ".#### #.... #.... #.... .###. ....# ....# ....# ####."],
  ["T", "####### ...#... ...#... ...#... ...#... ...#... ...#... ...#... ...#..."],
  ["T", "###### ..#... ..#... ..#... ..#... ..#... ..#... ..#... ..#..."],
  ["U", "#....# #....# #....# #....# #....# #....# #....# #....# .####."],
  ["V", "#.....# .#....# .#...#. .#...#. ..#..#. ..#.#.. ..#.#.. ...##.. ...#..."],
  ["Y", "#.....# .#...#. .#..#.. ..#.#.. ...#... ...#... ...#... ...#... ...#..."],
  ["Z", "##### ....# ...#. ..##. ..#.. .#... ##... #.... #####"],
  ["Z", ".##### .....# ....#. ...##. ...#.. ..#... .##... .#.... ######"],
  ["Z", "#####. ....#. ...#.. ..##.. ..#... .#.... ##.... #..... ######"],
  ["p", "..... ..... ####. #...# #...# #...# #...# #..## ####."],
  ["r", ".... .... #.#. ##.. #... #... #... #... #..."],
  ["s", ".... .... .### #... #... .##. ...# ...# ###."],
  ["t", "#... #... #### #... #... #... #... #... .##."],
  ["z", "..... ..... .#### ..... ...#. ..#.. .##.. .#... #####"],
  ["z", ".... .... #### ..#. ..#. .#.. ##.. #... ####"],
];

interface Glyph {
  ch: string;
  w: number;
  bits: boolean[]; // row-major GLYPH_H × w
}

const FONT: Glyph[] = FONT_SRC.map(([ch, src]) => {
  const rows = src.split(" ");
  if (rows.length !== GLYPH_H) throw new Error(`glyph ${ch} has ${rows.length} rows`);
  return { ch, w: rows[0].length, bits: rows.join("").split("").map((c) => c === "#") };
});

class Bitmap {
  constructor(private img: Rgba) {}
  private px(x: number, y: number) {
    const i = (y * this.img.width + x) * 4;
    return [this.img.data[i], this.img.data[i + 1], this.img.data[i + 2]] as const;
  }
  dark(x: number, y: number) {
    const [r, g, b] = this.px(x, y);
    return (r + g + b) / 3 < DARK;
  }
  pink(x: number, y: number) {
    const [r, g, b] = this.px(x, y);
    return r > 235 && g < 228 && b < 228 && r - g > 15;
  }
}

function readLine(bm: Bitmap, x0: number, x1: number, y0: number): string {
  const W = x1 - x0;
  const bit = (x: number, y: number) => x < W && bm.dark(x0 + x, y0 + y);
  const colDark = (x: number) => {
    for (let y = 0; y < GLYPH_H; y++) if (bit(x, y)) return true;
    return false;
  };
  const cost = (g: Glyph, x: number) => {
    let miss = 0;
    for (let y = 0; y < GLYPH_H; y++) for (let k = 0; k < g.w; k++) if (bit(x + k, y) !== g.bits[y * g.w + k]) miss++;
    // A glyph should be followed by a gap; ink right after it means we cut a wider glyph short.
    if (x + g.w < W && colDark(x + g.w)) miss += 2;
    return miss;
  };

  let out = "";
  let gap = 0;
  for (let x = 0; x < W; ) {
    if (!colDark(x)) {
      gap++;
      x++;
      continue;
    }
    if (out && gap >= 4) out += " ";
    gap = 0;
    let best: Glyph | null = null;
    let bestScore = Infinity;
    for (const g of FONT) {
      if (x + g.w > W + 1) continue;
      const score = cost(g, x) / (g.w * GLYPH_H) - g.w * 0.002; // tie → prefer wider glyph
      if (score < bestScore) {
        bestScore = score;
        best = g;
      }
    }
    if (best && bestScore < 0.12) {
      out += best.ch;
      x += best.w;
    } else {
      // Unknown ink (accents, the small font used inside block cells): skip it.
      while (x < W && colDark(x)) x++;
    }
  }
  return out.trim();
}

/** Reads every non-empty sub-cell of one day image. */
export function readSchoolDay(img: Rgba): Cell[] {
  if (img.width !== 1242 || img.height < ROW_TOP + CLASSES.length * ROW_HEIGHT)
    throw new Error(`Unexpected timetable image size ${img.width}×${img.height}`);
  const bm = new Bitmap(img);
  const cells: Cell[] = [];
  CLASSES.forEach((cls, r) => {
    for (let c = 0; c < 36; c++) {
      const x0 = COLS[c] + 2;
      const x1 = COLS[c + 1] - 1;
      const top = ROW_TOP + r * ROW_HEIGHT;
      const [subject, teacher, rawRoom] = LINE_OFFSETS.map((off) => readLine(bm, x0, x1, top + off));
      if (!subject && !teacher && !rawRoom) continue;
      // The narrow "1" leaves a gap wide enough to read as a space ("21 1"); a room number never has one.
      const room = rawRoom.replace(/ /g, "");
      // SIS highlights only the changed line (e.g. just the room), so check each line separately.
      const changed = LINE_OFFSETS.some((off) => {
        let pink = 0;
        let total = 0;
        for (let y = top + off - 1; y < top + off + GLYPH_H; y++)
          for (let x = x0; x < x1; x++) {
            total++;
            if (bm.pink(x, y)) pink++;
          }
        return pink / total > 0.3;
      });
      cells.push({ cls, period: Math.floor(c / 3), slot: c % 3, subject, teacher, room, changed });
    }
  });
  return cells;
}
