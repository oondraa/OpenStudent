import { createContext, useContext, useLayoutEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from "react";
import { SpringValue, lite, project } from "./spring";

/** The back action of the open screen and where it leads (LargeHeader shows a back button when there is one). */
export const BackContext = createContext<{ go: () => void; label: string } | null>(null);
export const useBack = () => useContext(BackContext);

export interface LayerHandle {
  close(): void;
}

const TILE_RADIUS = 26;
const EDGE = 20; // px from the left edge where the back swipe starts
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A screen that grows out of its home tile and shrinks back into it, like an app launching from the home screen.
 * `p` is the open progress (0 = the tile, 1 = full screen), `d` the back swipe (0 = in place, 1 = pushed off to
 * the right). Both are springs, so opening, closing and the swipe can interrupt each other at any frame.
 */
export function ScreenLayer({ tile, home, animate, handle, onClosed, children }: {
  /** `data-tile` of the home tile this screen belongs to */
  tile: string;
  home: RefObject<HTMLElement | null>;
  /** false = already open on the first frame (opened from a notification while the splash covers the app) */
  animate: boolean;
  handle: RefObject<LayerHandle | null>;
  /** `swiped`: closed by the back swipe, so the history entry is still there */
  onClosed: (swiped: boolean) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const s = useRef({ p: animate ? 0 : 1, d: 0, origin: null as DOMRect | null });
  const springs = useRef<{ p: SpringValue; d: SpringValue } | null>(null);
  const drag = useRef<{ x0: number; pts: { x: number; t: number }[] } | null>(null);

  // Where the tile sits with the home screen at full size (the home scales down behind an open screen).
  function measureTile() {
    const el = document.querySelector(`[data-tile="${tile}"]`);
    const r = el?.getBoundingClientRect();
    const hs = home.current ? home.current.getBoundingClientRect().width / innerWidth : 1;
    if (!r || !hs) return null;
    const un = (v: number, c: number) => (v - c) / hs + c;
    const [cx, cy] = [innerWidth / 2, innerHeight / 2];
    return new DOMRect(un(r.left, cx), un(r.top, cy), r.width / hs, r.height / hs);
  }

  function paint() {
    const { p, origin } = s.current;
    const d = Math.max(0, s.current.d);
    const W = innerWidth;
    const H = innerHeight;
    const shown = clamp01(p) * (1 - d);
    // Own GPU layers while anything moves (styles.css, .moving), back to plain paint once settled.
    const moving = p < 0.9995 || d > 0;
    // Android scales nothing (see `slide` below), so the home needs no layer of its own either.
    const slide = lite();
    root.current!.classList.toggle("moving", moving);
    home.current?.classList.toggle("moving", moving && !slide);
    home.current?.classList.toggle("behind", shown > 0);
    const hs = slide ? 1 : 1 - 0.06 * shown;
    if (home.current) home.current.style.transform = hs < 0.9999 ? `scale(${hs})` : "";
    scrim.current!.style.opacity = String(0.3 * shown);

    const c = card.current!;
    const inner = content.current!;
    c.style.transform = d > 0 ? `translateX(${d * W}px)` : "";
    if (p >= 0.9995 || !origin) {
      c.style.clipPath = "";
      c.style.opacity = "";
      inner.style.transform = "";
      inner.style.opacity = "";
      return;
    }
    // The tile as it looks right now, on the scaled-down home screen.
    const at = (v: number, center: number) => (v - center) * hs + center;
    const t = { l: at(origin.left, W / 2), t: at(origin.top, H / 2), r: at(origin.right, W / 2), b: at(origin.bottom, H / 2) };
    const q = 1 - p;
    if (slide) {
      // Android: the screen slides in a little from the tile's side and fades in, at full size. Any change of scale
      // makes Chrome raster the scrolling content again at the new size, on every frame (measured on a phone: each
      // screen rastered some 40 times while opening, the GPU at 100 %). Moving it keeps the tiles it rastered once.
      const sx = ((t.l + t.r) / 2 - W / 2) * 0.15 * q;
      const sy = ((t.t + t.b) / 2 - H / 2) * 0.15 * q;
      c.style.transform = `translate(${(sx + d * W).toFixed(2)}px, ${sy.toFixed(2)}px)`;
      c.style.opacity = String(clamp01(p / 0.5));
      return;
    }
    // Content scales uniformly (text never squashes) and stays centred in the growing rect.
    const scale = lerp((t.r - t.l) / W, 1, p);
    const cx = lerp((t.l + t.r) / 2, W / 2, p) - W / 2;
    const cy = lerp((t.t + t.b) / 2, H / 2, p) - H / 2;
    const move = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    const px = (n: number) => `${Math.max(0, n).toFixed(2)}px`;
    c.style.clipPath = `inset(${px(t.t * q)} ${px((W - t.r) * q)} ${px((H - t.b) * q)} ${px(t.l * q)} round ${px(TILE_RADIUS * q)})`;
    c.style.opacity = String(clamp01(p / 0.18));
    inner.style.transform = move;
    inner.style.opacity = String(clamp01((p - 0.08) / 0.5));
  }

  // Layout effect: the first frame already shows the screen at the tile, never full size for a flash.
  useLayoutEffect(() => {
    s.current.origin = measureTile();
    const sp = {
      p: new SpringValue(s.current.p, (v) => ((s.current.p = v), paint())),
      d: new SpringValue(0, (v) => ((s.current.d = v), paint())),
    };
    springs.current = sp;
    paint();
    if (animate) sp.p.to(1, { response: 0.42 });
    handle.current = {
      close() {
        if (s.current.d > 0) return; // mid-swipe: the finger decides
        s.current.origin = measureTile();
        card.current!.style.pointerEvents = "none"; // the home is usable while the screen settles into its tile
        sp.p.to(0, { response: 0.36 }, () => onClosed(false));
      },
    };
    return () => {
      sp.p.stop();
      sp.d.stop();
      handle.current = null;
      if (home.current) home.current.style.transform = "";
      home.current?.classList.remove("moving", "behind");
    };
  }, []);

  // Back swipe from the left edge: follows the finger 1:1, then a flick decides (projected landing point).
  function down(e: PointerEvent) {
    const sp = springs.current!;
    if (s.current.p < 0.98) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    sp.d.stop();
    drag.current = { x0: e.clientX - s.current.d * innerWidth, pts: [{ x: e.clientX, t: e.timeStamp }] };
  }
  function move(e: PointerEvent) {
    if (!drag.current) return;
    drag.current.pts = [...drag.current.pts.slice(-5), { x: e.clientX, t: e.timeStamp }];
    springs.current!.d.set(Math.max(0, (e.clientX - drag.current.x0) / innerWidth));
  }
  function up(e: PointerEvent) {
    const g = drag.current;
    if (!g) return;
    drag.current = null;
    // A tap, not a swipe: it belongs to whatever is under the edge strip (the back button, the week arrow).
    if (e.type === "pointerup" && Math.abs(e.clientX - g.pts[0].x) < 8 && s.current.d < 0.02) {
      springs.current!.d.set(0);
      const strip = e.currentTarget as HTMLElement;
      strip.style.pointerEvents = "none";
      const below = document.elementFromPoint(e.clientX, e.clientY);
      strip.style.pointerEvents = "";
      (below?.closest("button, a, [role=tab]") as HTMLElement | null)?.click();
      return;
    }
    const pts = [...g.pts, { x: e.clientX, t: e.timeStamp }].filter((pt) => e.timeStamp - pt.t < 100);
    const dt = (pts[pts.length - 1].t - pts[0].t) / 1000;
    const v = dt > 0 ? (pts[pts.length - 1].x - pts[0].x) / dt : 0;
    const W = innerWidth;
    const landing = s.current.d * W + project(v);
    const commit = v > -50 && landing > W / 2;
    springs.current!.d.to(commit ? 1 : 0, { response: 0.34, velocity: v / W }, commit ? () => onClosed(true) : undefined);
  }

  return (
    <div className="layer" ref={root}>
      <div className="layer-scrim" ref={scrim} />
      <div className="layer-card" ref={card}>
        <div className="layer-content" ref={content}>
          {children}
        </div>
        <div className="edge" aria-hidden="true" style={{ width: EDGE }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>
    </div>
  );
}
