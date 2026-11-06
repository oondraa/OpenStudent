import type { ReactNode } from "react";
import type { Place } from "../shared/places";
import { logoOf } from "./tripsData";

type Group = "mall" | "food" | "drink" | "cafe" | "shop" | "sport" | "other";

/** Line icons (24 × 24, stroke = currentColor) for the kinds of places, on a tint of their own. */
const GLYPHS: Record<Group, ReactNode> = {
  // a shopping bag
  mall: (
    <>
      <path d="M5 8h14l-1 12H6L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  // fork and knife
  food: (
    <>
      <path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M9 3v6" />
      <path d="M17 21V3c-2 1.5-3 4-3 7v3h3" />
    </>
  ),
  // a beer mug
  drink: (
    <>
      <path d="M6 7h10v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7Z" />
      <path d="M16 10h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2M6 7a2.5 2.5 0 0 1 2.5-3c.8-1 2.7-1 3.5 0a2.5 2.5 0 0 1 4 3M10 11v6M13 11v6" />
    </>
  ),
  // a cup
  cafe: (
    <>
      <path d="M5 9h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Z" />
      <path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3" />
    </>
  ),
  // a shopping cart
  shop: (
    <>
      <path d="M3 4h2l2.4 11h10.2L20 7H6.2" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
    </>
  ),
  // a ball
  sport: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  // a pin
  other: (
    <>
      <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
};

function groupOf(kind: string): Group {
  if (kind === "mall" || kind === "department_store") return "mall";
  if (kind === "pub" || kind === "bar" || kind === "biergarten") return "drink";
  if (kind === "fast_food" || kind === "restaurant" || kind === "ice_cream" || kind === "bakery") return "food";
  if (kind === "cafe") return "cafe";
  if (kind === "convenience" || kind === "supermarket") return "shop";
  if (/sport|fitness|swimming|bowling/.test(kind)) return "sport";
  return "other";
}

/** The place's own logo when known, otherwise an icon for its kind. */
export function PlaceIcon({ place }: { place: Place }) {
  const logo = logoOf(place);
  if (logo) return <img className="sq-icon" src={logo} alt="" />;
  const g = groupOf(place[1]);
  return (
    <span className={`sq-icon sq-icon-${g}`} aria-hidden>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[g]}
      </svg>
    </span>
  );
}
