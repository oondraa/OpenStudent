import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { addDays, todayPrague, WEEKDAYS } from "./time";
import { useBack } from "./layer";
import { lift } from "./glass";

export function LargeHeader({ title, subtitle, accessory, loading, children }: {
  /** Empty: no title row (the screen says what it is by itself). */
  title: string;
  subtitle?: string;
  accessory?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}) {
  const back = useBack();
  return (
    <header className="large-header">
      {back && (
        <button className="back glass" onClick={back.go}>
          <Chevron dir="left" />
          {back.label}
        </button>
      )}
      {(title || accessory) && (
        <div className="large-header-row">
          <div>
            {subtitle && <p className="eyebrow">{subtitle}</p>}
            {title && <h1 className="large-title">{title}</h1>}
          </div>
          {accessory}
        </div>
      )}
      {children}
      {loading && <div className="progress" role="progressbar" aria-label="Načítání" />}
    </header>
  );
}

/** Mon–Fri strip for the week of `monday`; arrows move whole weeks. */
export function DayStrip({ monday, selected, onSelect }: { monday: string; selected: string; onSelect: (iso: string) => void }) {
  const today = todayPrague();
  const index = [0, 1, 2, 3, 4].findIndex((i) => addDays(monday, i) === selected);
  const thumb = useLifted(index);
  return (
    <div className="day-strip glass">
      <button className="week-arrow" aria-label="Předchozí týden" onClick={() => onSelect(addDays(selected, -7))}>
        <Chevron dir="left" />
      </button>
      <div className="day-strip-days" role="tablist">
        {/* One pill that slides between days instead of five that blink on and off. */}
        {index >= 0 && <span ref={thumb} className="day-thumb" aria-hidden="true" style={{ "--i": index } as React.CSSProperties} />}
        {[0, 1, 2, 3, 4].map((i) => {
          const iso = addDays(monday, i);
          const active = iso === selected;
          return (
            <button
              key={iso}
              role="tab"
              aria-selected={active}
              className={`day ${active ? "active" : ""} ${iso === today ? "today" : ""}`}
              onClick={() => onSelect(iso)}
            >
              <span className="day-name">{WEEKDAYS[i].slice(0, 2)}</span>
              <span className="day-num">{Number(iso.slice(8))}</span>
            </button>
          );
        })}
      </div>
      <button className="week-arrow" aria-label="Další týden" onClick={() => onSelect(addDays(selected, 7))}>
        <Chevron dir="right" />
      </button>
    </div>
  );
}

/**
 * Horizontal pager over the 5 weekdays using native scroll-snap: it tracks the finger 1:1,
 * keeps momentum and can be grabbed mid-flight, which a scripted animation can't match.
 */
export function DayPager({ index, onIndex, children }: { index: number; onIndex: (i: number) => void; children: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const fromScroll = useRef(false);
  const placed = useRef(false);
  // Page a tap is gliding to: scroll events on the way (passing Tuesday on the way to Friday) are ignored.
  const gliding = useRef<number | null>(null);

  // Layout effect: the first paint already shows the right day instead of Monday jumping to it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    const left = index * el.clientWidth;
    const glide = placed.current && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    placed.current = true;
    if (Math.abs(el.scrollLeft - left) < 2) return;
    gliding.current = glide ? index : null;
    el.scrollTo({ left, behavior: glide ? "smooth" : "instant" });
  }, [index]);

  return (
    <div
      ref={ref}
      className="pager"
      onPointerDown={() => (gliding.current = null)} // a finger takes over from the glide
      onScroll={(e) => {
        const el = e.currentTarget;
        const i = Math.round(el.scrollLeft / el.clientWidth);
        if (Math.abs(el.scrollLeft - i * el.clientWidth) >= 2) return;
        if (gliding.current !== null) {
          if (i === gliding.current) gliding.current = null;
          return;
        }
        if (i !== index) {
          fromScroll.current = true;
          onIndex(i);
        }
      }}
    >
      {children.map((child, i) => (
        <div className="page" key={i} inert={i !== index}>
          {child}
        </div>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const thumb = useLifted(i);
  return (
    <div className="segmented" role="radiogroup" aria-label={label} style={{ "--n": options.length, "--i": i } as React.CSSProperties}>
      <span ref={thumb} className="segmented-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A selection pill lifts into glass whenever it moves to another option (not when it first appears). */
function useLifted(index: number) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(index);
  useEffect(() => {
    if (last.current !== index && last.current >= 0 && index >= 0) lift(ref.current);
    last.current = index;
  }, [index]);
  return ref;
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  );
}

/** `grid`: on a computer the rows become separate cards side by side (styles.css, .list.grid). */
export function Section({ title, footer, grid, children }: { title?: string; footer?: ReactNode; grid?: boolean; children: ReactNode }) {
  return (
    <section className="list-section">
      {title && <h2 className="list-title">{title}</h2>}
      <div className={`list ${grid ? "grid" : ""}`}>{children}</div>
      {footer && <p className="list-footer">{footer}</p>}
    </section>
  );
}

export function Chevron({ dir = "right" }: { dir?: "left" | "right" | "down" | "up" }) {
  const rot = { left: 180, right: 0, down: 90, up: -90 }[dir];
  return (
    <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
    </div>
  );
}

/** Placeholder card with a shimmer, shaped like the content that is loading. */
export function Skeleton({ lines = 2, side = false, tall = false }: { lines?: number; side?: boolean; tall?: boolean }) {
  return (
    <div className={`skeleton ${tall ? "tall" : ""}`} aria-hidden="true">
      {side && <span className="sk-block" />}
      <span className="sk-lines">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="sk-line" style={{ width: `${[62, 38, 50][i % 3]}%` }} />
        ))}
      </span>
      {side && <span className="sk-chip" />}
    </div>
  );
}

export function SkeletonList({ count, ...props }: { count: number; lines?: number; side?: boolean; tall?: boolean }) {
  return (
    <div className="skeleton-list stagger" role="status" aria-label="Načítání">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton {...props} />
        </div>
      ))}
    </div>
  );
}
