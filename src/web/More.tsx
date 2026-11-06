import { LargeHeader, Section, Chevron } from "./ui";
import { LABELS, type Tab } from "./sections";
import { TAB_ICONS } from "./icons";

/** Tab bar layout: everything that didn't fit in the bar, plus Settings. */
export function More({ items, onOpen }: { items: Tab[]; onOpen: (tab: Tab) => void }) {
  return (
    <div className="screen">
      <LargeHeader title="Více" />
      <div className="scroll">
        <Section>
          {[...items, "settings" as const].map((t) => (
            <button key={t} className={`row more-row tint-${t}`} onClick={() => onOpen(t)}>
              <span className="more-icon">{TAB_ICONS[t]}</span>
              <span className="row-title">{LABELS[t]}</span>
              <Chevron />
            </button>
          ))}
        </Section>
      </div>
    </div>
  );
}
