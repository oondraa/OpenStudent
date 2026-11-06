import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { BikeStation, Journey, Point } from "../shared/transit";
import { isDark } from "./theme";

// OpenStreetMap's own tiles. Their policy wants a Referer, which the app otherwise never sends (Referrer-Policy:
// no-referrer), so the tiles ask for just the origin. In dark mode a CSS filter turns them dark (styles.css).
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const HK: L.LatLngTuple = [50.2092, 15.8328];

const COLORS = { walk: "#8e8e93", ride: "#0a84ff", bike: "#30d158", back: "#ff9f0a" };

/**
 * The map of SideQuesty: start, school, target, nextbike stations and the chosen journeys.
 * Without `onPick` it's a still preview (no panning, no taps: a scrolling thumb would hit it all the time) and a tap
 * calls `onOpen`; with `onPick` (full screen) it moves and a tap picks a point.
 */
export function TripMap({ origin, school, target, stations, there, back, onPick, onOpen }: {
  origin: Point | null;
  school: Point;
  target: Point | null;
  stations: BikeStation[];
  there: Journey | null;
  back: Journey | null;
  onPick?: (p: { lat: number; lon: number }) => void;
  onOpen?: () => void;
}) {
  const live = !!onPick;
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ marks: L.LayerGroup; routes: L.LayerGroup; bikes: L.LayerGroup } | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!el.current) return;
    const still = { dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false };
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, ...(live ? {} : still) }).setView(HK, 13);
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, referrerPolicy: "strict-origin", className: isDark() ? "trip-tiles-dark" : "" }).addTo(m);
    m.attributionControl.setPrefix(false);
    m.on("click", (e: L.LeafletMouseEvent) => pick.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }));
    layers.current = { bikes: L.layerGroup().addTo(m), routes: L.layerGroup().addTo(m), marks: L.layerGroup().addTo(m) };
    map.current = m;
    // The screen slides in: the map measures itself once it has its final size.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const l = layers.current;
    if (!l) return;
    l.bikes.clearLayers();
    for (const s of stations)
      L.circleMarker([s.lat, s.lon], { radius: 4, weight: 1, color: "#fff", fillColor: s.bikes ? COLORS.bike : "#8e8e93", fillOpacity: 0.9 })
        .bindTooltip(`${s.name} · ${s.bikes} ${s.bikes === 1 ? "kolo" : s.bikes >= 2 && s.bikes <= 4 ? "kola" : "kol"}`)
        .addTo(l.bikes);
  }, [stations]);

  useEffect(() => {
    const l = layers.current;
    const m = map.current;
    if (!l || !m) return;
    l.marks.clearLayers();
    l.routes.clearLayers();
    const draw = (j: Journey | null, returning: boolean) => {
      for (const leg of j?.legs ?? []) {
        // Walks and rides follow the streets (path); a bus line is drawn stop to stop.
        const pts: L.LatLngTuple[] = leg.kind === "ride" ? leg.stops.map((p) => [p.lat, p.lon]) : (leg.path ?? [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]]);
        const color = returning ? COLORS.back : COLORS[leg.kind];
        L.polyline(pts, { color, weight: leg.kind === "walk" ? 4 : 6, opacity: returning ? 0.75 : 0.95, dashArray: leg.kind === "walk" ? "2 8" : undefined, lineCap: "round" }).addTo(l.routes);
      }
    };
    draw(back, true);
    draw(there, false);
    const dot = (p: Point, color: string, label: string, r = 8) =>
      L.circleMarker([p.lat, p.lon], { radius: r, weight: 3, color: "#fff", fillColor: color, fillOpacity: 1 }).bindTooltip(label).addTo(l.marks);
    dot(school, "#ff5a1f", "Škola", 7);
    if (origin && (origin.lat !== school.lat || origin.lon !== school.lon)) dot(origin, "#0a84ff", "Start");
    if (target) dot(target, "#ff375f", target.name, 9);
  }, [origin, school, target, there, back]);

  // Framed when the target or the journey changes, not on every GPS update (the map would keep jumping).
  // The full map is framed once when it opens; after that its taps mustn't make it fly around.
  const located = !!origin;
  const framed = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || (live && framed.current)) return;
    framed.current = !!origin;
    const pts = [origin, target, ...(there?.legs.flatMap((x) => (x.kind === "ride" ? x.stops : (x.path?.map(([lat, lon]) => ({ name: "", lat, lon })) ?? [x.from, x.to]))) ?? [])].filter(Boolean) as Point[];
    if (target && pts.length > 1) m.flyToBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])), { padding: [36, 36], maxZoom: 16, duration: 0.6 });
    else if (origin && !target) m.setView([origin.lat, origin.lon], 14);
  }, [target, there, located]);

  if (live) return <div ref={el} className="trip-map full" role="application" aria-label="Mapa, klepnutím vybereš cíl" />;
  return (
    <div className="trip-map-wrap">
      <div ref={el} className="trip-map" aria-hidden />
      <button className="trip-map-open" onClick={onOpen} aria-label="Otevřít mapu přes celou obrazovku">
        <span className="trip-map-hint">Otevřít mapu</span>
      </button>
    </div>
  );
}
