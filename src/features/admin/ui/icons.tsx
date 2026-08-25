// Tiny inline icon set (no icon dependency installed). 24x24 stroke icons.

interface IconProps {
  className?: string;
}

function base(props: IconProps, children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className ?? 'h-5 w-5'}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: IconProps) =>
  base(p, <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></>);

export const IconInbox = (p: IconProps) =>
  base(p, <><path d="M4 4h16v16H4z" /><path d="M4 14h5l1.5 2h3L15 14h5" /></>);

export const IconGrid = (p: IconProps) =>
  base(p, <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>);

export const IconBell = (p: IconProps) =>
  base(p, <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 19a2 2 0 0 0 4 0" /></>);

export const IconMap = (p: IconProps) =>
  base(p, <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>);

export const IconUsers = (p: IconProps) =>
  base(p, <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5a3.5 3.5 0 0 1 0 6.6" /><path d="M17.5 13.6a6.5 6.5 0 0 1 4 6.4" /></>);

export const IconSettings = (p: IconProps) =>
  base(p, <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" /></>);

export const IconScroll = (p: IconProps) =>
  base(p, <><path d="M6 3h13v16a2 2 0 0 1-2 2H8" /><path d="M6 3a2 2 0 0 0-2 2v2h4V5a2 2 0 0 0-2-2z" /><path d="M8 21a2 2 0 0 1-2-2V7" /><path d="M10 8h6M10 12h6M10 16h4" /></>);

export const IconMenu = (p: IconProps) =>
  base(p, <><path d="M4 7h16M4 12h16M4 17h16" /></>);

export const IconLogout = (p: IconProps) =>
  base(p, <><path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8" /><path d="m17 8 4 4-4 4M9 12h12" /></>);

export const IconSearch = (p: IconProps) =>
  base(p, <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);

export const IconRotate = (p: IconProps) =>
  base(p, <><path d="M20 8A8 8 0 1 0 21 14" /><path d="M20 3v5h-5" /></>);

export const IconExternal = (p: IconProps) =>
  base(p, <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" /></>);

export const IconWhatsapp = (p: IconProps) =>
  base(p, <><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z" /><path d="M8.8 9.2c.3 2.7 3.3 5.7 6 6l1.4-1.4-2-1.2-1 .7c-.8-.4-1.7-1.3-2.1-2.1l.7-1-1.2-2-1.8 1z" /></>);

export const IconDots = (p: IconProps) =>
  base(p, <><circle cx="12" cy="5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="19" r="1.2" /></>);

export const IconChevronLeft = (p: IconProps) => base(p, <path d="m14 6-6 6 6 6" />);
export const IconChevronRight = (p: IconProps) => base(p, <path d="m10 6 6 6-6 6" />);

export const IconWarning = (p: IconProps) =>
  base(p, <><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 9.5V14" /><circle cx="12" cy="17" r="0.4" fill="currentColor" /></>);

export const IconCheck = (p: IconProps) => base(p, <path d="m4.5 12.5 5 5 10-11" />);

// Contabilidad: a ledger column with a coin — money recorded, not just money.
export const IconLedger = (p: IconProps) =>
  base(p, <><path d="M4 3h11l5 5v13H4z" /><path d="M15 3v5h5" /><path d="M8 12h8" /><path d="M8 16h5" /></>);

// Analítica: barras de distinta altura — magnitud comparada, que es de lo que
// trata la sección.
export const IconChart = (p: IconProps) =>
  base(p, <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M3 20h18" /></>);

// Urbanizaciones: capas apiladas — varios proyectos sobre la misma base.
export const IconLayers = (p: IconProps) =>
  base(p, <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>);

export const IconStore = (p: IconProps) =>
  base(p, <><path d="M4 4h16l1.5 4.5a3 3 0 0 1-2.9 3.5 3 3 0 0 1-3-2.5 3 3 0 0 1-3.1 2.5 3 3 0 0 1-3-2.5 3 3 0 0 1-3.1 2.5A3 3 0 0 1 2.5 8.5Z" /><path d="M5 12v8h14v-8" /><path d="M10 20v-5h4v5" /></>);

export const IconExchange = (p: IconProps) =>
  base(p, <><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></>);
