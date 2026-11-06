import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { kindLabel, matchesPlace, type Place } from "../shared/places";
import { distance } from "../shared/transit";
import { SCHOOL, loadPlaces, placeKey, useShortcuts, useStatic } from "./tripsData";
import { PlaceIcon } from "./PlaceIcon";
import { SearchIcon } from "./icons";
import { isDark } from "./theme";

const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);

/** The list of shortcuts with their nicknames, and a search to add more (results numbered on a small map). */
export default function SqPlacesEditor() {
  const places = useStatic(loadPlaces);
  const shortcuts = useShortcuts();
  const [query, setQuery] = useState("");
  if (!places) return <p className="row sq-set-note">Načítám místa…</p>;
  if (places instanceof Error) return <p className="row sq-set-note">Místa se nepodařilo načíst.</p>;
  const all = places.places;
  const mine = shortcuts.list(all);
  const q = query.trim().toLocaleLowerCase("cs");
  const found = q ? all.filter((p) => !shortcuts.has(p, all) && matchesPlace(p, q)).slice(0, 15) : [];

  return (
    <>
      {mine.map((s) => (
        <div key={`${placeKey(s.place)}|${s.nick ?? ""}`} className="row sq-set-row">
          <PlaceIcon place={s.place} />
          <span className="row-main">
            <input
              className="sq-nick"
              aria-label={`Přezdívka pro ${s.place[0]}`}
              placeholder={s.place[0]}
              defaultValue={s.nick ?? ""}
              onBlur={(e) => e.target.value !== (s.nick ?? "") && shortcuts.rename(s.place, e.target.value, all)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <span className="row-sub">
              {s.nick ? `${s.place[0]} · ` : ""}
              {kindLabel(s.place[1])}
            </span>
          </span>
          <button className="sq-set-btn remove" aria-label={`Odebrat ${s.place[0]}`} onClick={() => shortcuts.toggle(s.place, all)}>
            −
          </button>
        </div>
      ))}
      {!mine.length && <p className="row sq-set-note">Zatím žádná. Přidej si je hledáním níž.</p>}
      <p className="row sq-set-note">Klepni na název a napiš, jak tomu místu říkáš.</p>

      <div className="row">
        <label className="search sq-set-search">
          <SearchIcon size={18} />
          <input type="search" placeholder="Přidat: večerka, hospoda, kafe…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      {q && !found.length && <p className="row sq-set-note">Nic takového nenacházím.</p>}
      {found.length > 0 && (
        <>
          <div className="row sq-mini-row">
            <MiniMap places={found} />
          </div>
          {found.map((p, i) => (
            <div key={placeKey(p)} className="row sq-set-row">
              <span className="sq-pin-num">{i + 1}</span>
              <span className="row-main">
                <span className="row-title">{p[0]}</span>
                <span className="row-sub">
                  {kindLabel(p[1])} · {km(distance(SCHOOL, { lat: p[2], lon: p[3] }))} od školy
                </span>
              </span>
              <button className="sq-set-btn add" aria-label={`Přidat ${p[0]}`} onClick={() => shortcuts.toggle(p, all)}>
                +
              </button>
            </div>
          ))}
        </>
      )}
      {shortcuts.saved && (
        <button className="row sq-reset" onClick={shortcuts.reset}>
          Vrátit výchozí místa
        </button>
      )}
    </>
  );
}

/** The search results as numbered pins (the same numbers as in the list), with the school for orientation. */
function MiniMap({ places }: { places: Place[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
      referrerPolicy: "strict-origin",
      className: isDark() ? "trip-tiles-dark" : "",
    }).addTo(m);
    m.attributionControl.setPrefix(false);
    pins.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = pins.current;
    if (!m || !g) return;
    g.clearLayers();
    L.circleMarker([SCHOOL.lat, SCHOOL.lon], { radius: 6, weight: 2, color: "#fff", fillColor: "#ff5a1f", fillOpacity: 1 }).bindTooltip("Škola").addTo(g);
    places.forEach((p, i) =>
      L.marker([p[2], p[3]], { icon: L.divIcon({ className: "sq-pin", html: `<span>${i + 1}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(g),
    );
    const bounds = L.latLngBounds([[SCHOOL.lat, SCHOOL.lon], ...places.map((p) => [p[2], p[3]] as L.LatLngTuple)]);
    m.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 });
  }, [places]);

  return <div ref={el} className="sq-mini" aria-hidden />;
}
