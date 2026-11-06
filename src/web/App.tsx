import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, cache, Unauthorized } from "./api";
import { Login, Welcome } from "./Login";
import { Timetable } from "./Timetable";
import { Rooms } from "./Rooms";
import { Teachers } from "./Teachers";
import { Tests } from "./Tests";
import { Settings } from "./Settings";
import { Lunch } from "./Lunch";
import { Ends } from "./Ends";
import { More } from "./More";
// SideQuesty carry a map library and the bus timetables: loaded only when opened.
const Trips = lazy(() => import("./Trips").then((m) => ({ default: m.Trips })));
import { Home } from "./Home";
import { LABELS, LINKABLE, TAB_SLOTS, tabOrder, type Tab } from "./sections";
import { ClassPrompt } from "./ClassPrompt";
import { NotifyPrompt } from "./NotifyPrompt";
import { BackContext, ScreenLayer, type LayerHandle } from "./layer";
import { TAB_ICONS } from "./icons";
import { useDesktop } from "./hooks";
import { useUi } from "./theme";

/** "home": the tile grid, screens grow out of their tile. "tabs": a tab bar with the first few parts and "Více"
 * for the rest and Settings. Both orders are picked in Settings. */
export type Layout = "home" | "tabs";

/** Shorter names where the tab bar is narrow. */
const BAR_LABELS: Partial<Record<Tab, string>> = { rooms: "Učebny", ends: "Konce" };

export function App() {
  // The session cookie is HttpOnly, so "logged in" is remembered locally and corrected by the first 401.
  const [loggedIn, setLoggedIn] = useState(() => cache.get<boolean>("loggedIn") ?? false);
  const [layout, setLayout] = useState<Layout>(() => cache.get<Layout>("layout") ?? "home");
  // Notifications open their screen right away (/?tab=grades): over the home grid, or as the selected tab.
  const [linked] = useState(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return LINKABLE.includes(t as Tab) ? (t as Tab) : null;
  });
  // Home layout: the app lands on the grid, `screen` is the one opened over it.
  const [screen, setScreen] = useState<{ tab: Tab; animate: boolean } | null>(() =>
    layout === "home" && linked ? { tab: linked, animate: false } : null,
  );
  // Tab bar layout: the selected tab.
  const [tab, setTab] = useState<Tab>(linked ?? "timetable");
  // Home is in render state too, so it re-reads the cached glances once a screen closes (and the orders once changed).
  const [closedAt, setClosedAt] = useState(0);
  const home = useRef<HTMLDivElement>(null);
  const layer = useRef<LayerHandle>(null);
  const swiped = useRef(false);
  // Signing in plays the welcome over the switch from Login to the app (Login.tsx).
  const [welcome, setWelcome] = useState<{ x: number; y: number } | null>(null);
  const desktop = useDesktop();
  const ui = useUi();
  // Set directly, not as a prop: Home is memoized and must not render again just because a screen opened.
  useLayoutEffect(() => {
    if (home.current) home.current.inert = !!screen;
  });

  // Each open screen is a history entry, so the system back (Android, browser) closes it like the back button.
  useEffect(() => {
    if (screen && history.state?.screen !== screen.tab) {
      history.replaceState(null, "", "/");
      history.pushState({ screen: screen.tab }, "", "/");
    }
    const onPop = () => {
      if (swiped.current) swiped.current = false;
      else layer.current?.close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && layer.current && history.back();
    addEventListener("popstate", onPop);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("popstate", onPop);
      removeEventListener("keydown", onKey);
    };
  }, []);

  const open = useCallback((tab: Tab) => {
    history.pushState({ screen: tab }, "", "/");
    setScreen({ tab, animate: true });
  }, []);
  const back = useMemo(() => ({ go: () => history.back(), label: ui === "new" ? "Přehled" : "Domů" }), [ui]);
  // Tab bar layout: what's opened from "Více" leads back there.
  const moreBack = useMemo(() => ({ go: () => setTab("more"), label: "Více" }), []);
  const closed = useCallback((bySwipe: boolean) => {
    if (bySwipe) {
      swiped.current = true;
      history.back(); // drop the screen's history entry; onPop knows it's already closed
    }
    setScreen(null);
    setClosedAt(Date.now());
  }, []);

  const signOut = useCallback(() => {
    const theme = cache.get("theme");
    // Device preferences outlive the account: theme, layout and the orders.
    const keep = ["layout", "homeOrder", "tabOrder"].map((k) => [k, cache.get(k)] as const);
    cache.clear();
    if (theme) cache.set("theme", theme);
    for (const [k, v] of keep) if (v) cache.set(k, v);
    setLoggedIn(false);
    setScreen(null);
    setTab("timetable");
  }, []);

  const onError = useCallback(
    (e: unknown) => {
      if (!(e instanceof Unauthorized)) return false;
      signOut();
      return true;
    },
    [signOut],
  );

  // Always the second child of the top fragment, so it stays mounted while Login is swapped for the app under it.
  const overlay = welcome && (
    <Welcome
      origin={welcome}
      onCovered={() => {
        cache.set("loggedIn", true);
        setLoggedIn(true);
      }}
      onDone={() => setWelcome(null)}
    />
  );

  if (!loggedIn)
    return (
      <>
        <Login onDone={setWelcome} />
        {overlay}
      </>
    );

  // Switched in Settings, so Settings stays on screen: as the selected tab, or opened over the home grid.
  const changeLayout = (next: Layout) => {
    cache.set("layout", next);
    setLayout(next);
    if (next === "tabs") {
      history.replaceState(null, "", "/"); // its screen entry, if any, now leads nowhere
      setTab(screen?.tab ?? "settings");
      setScreen(null);
    } else {
      history.pushState({ screen: tab }, "", "/");
      setScreen({ tab, animate: false });
    }
  };

  const content = (t: Tab) => (
    <>
      {t === "timetable" && <Timetable onError={onError} />}
      {t === "rooms" && <Rooms onError={onError} />}
      {t === "teachers" && <Teachers onError={onError} />}
      {t === "tests" && <Tests onError={onError} />}
      {t === "ends" && <Ends onError={onError} />}
      {t === "lunch" && <Lunch onError={onError} />}
      {t === "trips" && (
        <Suspense fallback={<div className="screen" />}>
          <Trips onError={onError} />
        </Suspense>
      )}
      {t === "more" && <More items={tabOrder().slice(TAB_SLOTS)} onOpen={setTab} />}
      {t === "settings" && (
        <Settings
          onError={onError}
          layout={layout}
          onLayout={changeLayout}
          onOrder={() => setClosedAt(Date.now())}
          onLogout={async () => {
            const sub = await navigator.serviceWorker?.ready.then((r) => r.pushManager.getSubscription()).catch(() => null);
            await sub?.unsubscribe().catch(() => {});
            await api.logout().catch(() => {});
            signOut();
          }}
        />
      )}
    </>
  );

  // A computer: every part in a sidebar, whatever the phone layout says. Nothing here runs on a phone.
  if (desktop) {
    const shown = tab === "more" ? "timetable" : tab;
    return (
      <>
        <div className="desk">
          <nav className="sidebar" aria-label="Hlavní navigace">
            <p className="sidebar-brand">
              Open<b>Študent</b>
            </p>
            {[...tabOrder(), "settings" as const].map((t) => (
              <button
                key={t}
                className={`sidebar-item tint-${t} ${shown === t ? "active" : ""}`}
                aria-current={shown === t ? "page" : undefined}
                onClick={() => setTab(t)}
              >
                <span className="more-icon">{TAB_ICONS[t]}</span>
                {LABELS[t]}
              </button>
            ))}
          </nav>
          <main className="desk-content" key={shown}>
            {content(shown)}
          </main>
          <ClassPrompt onError={onError} />
          <NotifyPrompt onError={onError} />
        </div>
        {overlay}
      </>
    );
  }

  if (layout === "tabs") {
    const bar: Tab[] = [...tabOrder().slice(0, TAB_SLOTS), "more"];
    const inMore = !bar.includes(tab);
    return (
      <>
        <div className="app">
          <main className="tab-content" key={tab}>
            {inMore ? <BackContext.Provider value={moreBack}>{content(tab)}</BackContext.Provider> : content(tab)}
          </main>
          <nav className="tabbar" aria-label="Hlavní navigace">
            {bar.map((t) => {
              const active = tab === t || (t === "more" && inMore);
              return (
                <button key={t} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => setTab(t)}>
                  {TAB_ICONS[t]}
                  <span>{BAR_LABELS[t] ?? LABELS[t]}</span>
                </button>
              );
            })}
          </nav>
          <ClassPrompt onError={onError} />
          <NotifyPrompt onError={onError} />
        </div>
        {overlay}
      </>
    );
  }

  return (
    <>
      <>
        <Home homeRef={home} onOpen={open} onError={onError} refresh={closedAt} />
        {screen && (
          <BackContext.Provider value={back}>
            <ScreenLayer key={screen.tab} tile={screen.tab} home={home} animate={screen.animate} handle={layer} onClosed={closed}>
              {content(screen.tab)}
            </ScreenLayer>
          </BackContext.Provider>
        )}
        <ClassPrompt onError={onError} />
        <NotifyPrompt onError={onError} />
      </>
      {overlay}
    </>
  );
}
