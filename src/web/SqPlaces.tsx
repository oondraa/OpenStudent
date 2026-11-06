import { lazy, Suspense, useState } from "react";
import { useShortcuts } from "./tripsData";
import { Chevron, Section } from "./ui";

// The editor carries a map library: loaded only when opened, not with Nastavení.
const Editor = lazy(() => import("./SqPlacesEditor"));

/** Nastavení → SideQuesty: the places offered right away, under the names students use. */
export function SqPlaces() {
  const [open, setOpen] = useState(false);
  const shortcuts = useShortcuts();
  return (
    <Section title="SideQuesty" footer={open ? undefined : "Místa, která SideQuesty nabízí hned, a jak jim říkáš. Třeba Fůčko, Vietnamec nebo oblíbená hospoda."}>
      <button className="row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="row-main">
          <span className="row-title">Moje místa</span>
        </span>
        <span className="row-value">{shortcuts.saved ? shortcuts.saved.length : "výchozí"}</span>
        <Chevron dir={open ? "down" : undefined} />
      </button>
      {open && (
        <Suspense fallback={<p className="row sq-set-note">Načítám…</p>}>
          <Editor />
        </Suspense>
      )}
    </Section>
  );
}
