// Terrenalv wordmark, vector recreation of the brand logo: bold "TERREN" in
// green + "ALV" in earth brown, leaf on the T, house-shaped A, small S.R.L.
// `variant="inverse"` for dark backgrounds (white + amber).

const GREEN = '#14532d';
const LEAF = '#22c55e';
const BROWN = '#7c4f2c';

export function Logo({
  className,
  variant = 'brand',
  srl = true,
}: {
  className?: string;
  variant?: 'brand' | 'inverse';
  srl?: boolean;
}) {
  const c1 = variant === 'inverse' ? '#ffffff' : GREEN;
  const c2 = variant === 'inverse' ? '#fbbf24' : BROWN;
  const leaf = variant === 'inverse' ? '#86efac' : LEAF;
  return (
    <svg
      viewBox="0 0 560 96"
      className={className}
      role="img"
      aria-label="Terrenalv S.R.L."
    >
      {/* TERREN */}
      <text
        x="0"
        y="74"
        fontFamily="'Arial Black', Arial, sans-serif"
        fontWeight="900"
        fontSize="72"
        letterSpacing="-2"
        fill={c1}
      >
        TERREN
      </text>
      {/* Leaf curling off the T */}
      <path
        d="M22 22 C14 6 30 -4 46 2 C40 4 36 8 33 14 C30 20 28 22 22 22 Z"
        fill={leaf}
      />
      {/* House-A */}
      <g transform="translate(316 16)">
        <path
          d="M31 0 L62 62 L49 62 L31 24 L13 62 L0 62 Z"
          fill={c2}
        />
        <rect x="23" y="38" width="16" height="14" fill={c2} />
        <g stroke={variant === 'inverse' ? GREEN : '#faf8f4'} strokeWidth="2">
          <line x1="31" y1="38" x2="31" y2="52" />
          <line x1="23" y1="45" x2="39" y2="45" />
        </g>
      </g>
      {/* LV */}
      <text
        x="382"
        y="74"
        fontFamily="'Arial Black', Arial, sans-serif"
        fontWeight="900"
        fontSize="72"
        letterSpacing="-2"
        fill={c2}
      >
        LV
      </text>
      {srl && (
        <text
          x="516"
          y="34"
          fontFamily="Arial, sans-serif"
          fontWeight="700"
          fontSize="16"
          fill={c2}
          transform="rotate(-90 516 34)"
        >
          S.R.L.
        </text>
      )}
    </svg>
  );
}

/** Square mark (favicon / app icon / avatar): house-A + leaf on brand green. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Terrenalv">
      <rect width="64" height="64" rx="14" fill={GREEN} />
      <g transform="translate(14 16)">
        <path d="M18 0 L36 36 L28.5 36 L18 14 L7.5 36 L0 36 Z" fill="#e7d3b8" />
        <rect x="13.5" y="22" width="9" height="8" fill="#e7d3b8" />
        <g stroke={GREEN} strokeWidth="1.4">
          <line x1="18" y1="22" x2="18" y2="30" />
          <line x1="13.5" y1="26" x2="22.5" y2="26" />
        </g>
      </g>
      <path
        d="M20 14 C14 4 24 -3 34 1 C30 3 27 6 25 10 C23 13 24 14 20 14 Z"
        fill={LEAF}
      />
    </svg>
  );
}
