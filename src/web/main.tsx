import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { applyUi, savedUi } from "./theme";
import { initGlass } from "./glass";
import { lite } from "./spring";
import "./styles.css";

if (lite()) document.documentElement.setAttribute("data-lite", "");
applyUi(savedUi());
initGlass();

// Dev only: a fake location for SideQuesty (useLocation.ts), remembered until ?poloha=off.
if (import.meta.env.DEV) {
  const p = new URLSearchParams(location.search).get("poloha");
  if (p === "off") localStorage.removeItem("ost:devPoloha");
  else if (p) localStorage.setItem("ost:devPoloha", p);
  // ?cas=9:45: the time of day the app pretends it is (time.ts), until ?cas=off.
  const cas = new URLSearchParams(location.search).get("cas");
  if (cas === "off") localStorage.removeItem("ost:devCas");
  else if (cas) localStorage.setItem("ost:devCas", cas);
  // ?mock: the app without a server, for looking at screens (SideQuesty) in a browser that isn't logged in.
  const mock = new URLSearchParams(location.search).get("mock");
  if (mock === "off") localStorage.removeItem("ost:devMock");
  else if (mock !== null) localStorage.setItem("ost:devMock", "1");
  if (localStorage.getItem("ost:devMock")) {
    localStorage.setItem("ost:loggedIn", "true");
    const real = window.fetch.bind(window);
    const lesson = (start: string, end: string, subject: string) =>
      ({ id: null, subject, start, end, room: "", group: "", teacher: "", changed: false, cancelled: false, added: false, meet: null });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/api/")) return real(input, init);
      if (url.includes("/api/timetable")) {
        const week = new URL(url, location.href).searchParams.get("week") ?? new Date().toISOString().slice(0, 10);
        const monday = new Date(`${week}T12:00:00Z`);
        const days = [0, 1, 2, 3, 4].map((i) => {
          const d = new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10);
          return {
            date: d,
            label: "",
            lunch: { start: "11:30", end: "12:20" },
            lessons: [lesson("08:00", "08:45", "MAT"), lesson("08:55", "09:40", "CJL"), lesson("10:50", "11:35", "ANJ"), lesson("12:20", "13:05", "FYZ"), lesson("13:10", "13:55", "PRG")],
          };
        });
        return new Response(JSON.stringify({ week, days }), { headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "mock" }), { status: 503, headers: { "content-type": "application/json" } });
    };
  }
}

// A new version was downloaded in the background: put the splash back up with "Aktualizace", then reload into it.
// The flag tells the next page load (index.html) to keep saying so while the new version starts.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    try {
      sessionStorage.setItem("ost:updating", "1");
    } catch {
      /* private mode: the new splash just won't say it */
    }
    document.getElementById("splash")?.classList.replace("hide", "again");
    setTimeout(() => updateSW(true), 400);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/** Lets the splash intro (index.html) finish, then dissolves it into the app. */
function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // "Open" finishes sliding in at ~1.25 s after navigation start; hold a beat so it reads.
  const introEnd = reduce ? 250 : 1500;
  // The splash already uses the app's theme (index.html), so the status bar colour stays as applyTheme set it.
  setTimeout(() => {
    splash.classList.remove("note");
    splash.classList.add("hide"); // stays in the DOM (hidden) so an update can show it again
  }, Math.max(0, introEnd - performance.now()));
}
hideSplash();
