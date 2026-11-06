// Line icons on a 24×24 grid, stroked with currentColor (styled by .icon).
import type { ReactNode } from "react";
import type { Tab } from "./sections";

function Icon({ children, size }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {children}
    </svg>
  );
}

export const CalendarIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const DumbbellIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="4.5" y="7" width="3" height="10" rx="1.2" />
    <rect x="16.5" y="7" width="3" height="10" rx="1.2" />
    <path d="M7.5 12h9M2.5 10v4M21.5 10v4" />
  </Icon>
);

export const DoorIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 21h16M6.5 21V4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21" />
    <path d="M14.5 12.5h.01" />
  </Icon>
);

export const TeacherIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="9" cy="7.5" r="3.5" />
    <path d="M2.5 20.5a6.5 6.5 0 0 1 13 0M14 4.5h7.5v9H17" />
  </Icon>
);

/** A clipboard with a tick: tests and written exams. */
export const TestIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="5" y="4.5" width="14" height="16.5" rx="2.5" />
    <path d="M9 4.5V3.5h6v1M9 13l2 2 4-4.5" />
  </Icon>
);

/** A route between two pins: trips around town. */
export const RouteIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="6" cy="18" r="2.5" />
    <path d="M18 10.5c-2.2-2.4-3.5-4.2-3.5-5.6a3.5 3.5 0 0 1 7 0c0 1.4-1.3 3.2-3.5 5.6zM18 5h.01" />
    <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h2" />
  </Icon>
);

export const SearchIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </Icon>
);

export const GradesIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 20v-7M12 20V5M19 20v-10" />
  </Icon>
);

export const GearIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const ProjectIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M9 18h6M10 21.5h4" />
    <path d="M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.6.5.9 1.1.9 1.8v.5h6V16c0-.7.3-1.3.9-1.8A6.5 6.5 0 0 0 12 2.5z" />
  </Icon>
);

export const WalletIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M19 7.5V6a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20H19a2 2 0 0 0 2-2v-8.5a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 1 3 6.5" />
    <path d="M16.5 14h.01" />
  </Icon>
);

export const MoreIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="5.5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="18.5" cy="12" r="1.2" />
  </Icon>
);

export const UtensilsIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 3v6a3 3 0 0 0 3 3v9M10 3v6a3 3 0 0 1-3 3M7 3v5M20 15V3a5 5 0 0 0-4 5v5a2 2 0 0 0 2 2h2zm0 0v6" />
  </Icon>
);

export const AbsenceIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
    <path d="M4.5 4.5l15 15" />
  </Icon>
);

export const CalculatorIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="5" y="2.5" width="14" height="19" rx="3" />
    <path d="M8.5 6.5h7v3h-7zM8.5 13.5h.01M12 13.5h.01M15.5 13.5h.01M8.5 17.5h.01M12 17.5h.01M15.5 17.5h.01" />
  </Icon>
);

export const TargetIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.8" />
  </Icon>
);

export const BugIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="7" y="7.5" width="10" height="13" rx="5" />
    <path d="M9 7.5a3 3 0 0 1 6 0M12 11v9.5M3.5 13H7M17 13h3.5M4.5 8.5L7.5 10M19.5 8.5L16.5 10M4.5 19l3-2M19.5 19l-3-2" />
  </Icon>
);

export const CoffeeIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4.5 9h12v5.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" />
    <path d="M16.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.6M8.5 3.5v2.5M12.5 3.5v2.5" />
  </Icon>
);

export const SunIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Icon>
);

export const CalendarOffIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4M10 13.5l4 4M14 13.5l-4 4" />
  </Icon>
);

export const BookIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 6.5C10.5 5 8 4.5 4 4.5v14c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-14c-4 0-6.5.5-8 2zM12 6.5v14" />
  </Icon>
);

export const AlertIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4.5M12 17h.01" />
  </Icon>
);

/** A door with an arrow out: "Kdo kdy končí". */
export const DoorOutIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M13 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H13M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
  </Icon>
);

/** One icon per part of the app, for the tab bar, the Více list and the order editor in Settings. */
export const TAB_ICONS: Record<Tab, ReactNode> = {
  timetable: <CalendarIcon />,
  lunch: <UtensilsIcon />,
  rooms: <DoorIcon />,
  teachers: <TeacherIcon />,
  tests: <TestIcon />,
  ends: <DoorOutIcon />,
  trips: <RouteIcon />,
  settings: <GearIcon />,
  more: <MoreIcon />,
};
