// The real Terrenalv wordmark (public/logo.png — background removed from the
// brand's logo.jpg). An earlier hand-drawn SVG approximation lived here and was
// wrong in the details (leaf placement, the house-A's window), so it's gone.
//
// The wordmark's own green is nearly the brand green, so on a dark background it
// would disappear — `variant="inverse"` therefore sets it on a light chip rather
// than recolouring it, which is how the brand is meant to be reproduced.

import Image from 'next/image';

/** Intrinsic aspect of public/logo.png (1380 × 170). */
const RATIO = 1380 / 170;

export function Logo({
  className,
  variant = 'brand',
  srl = true,
  priority = false,
}: {
  className?: string;
  variant?: 'brand' | 'inverse';
  /** Kept for call-site compatibility; the artwork always includes S.R.L. */
  srl?: boolean;
  priority?: boolean;
}) {
  void srl;
  const img = (
    <Image
      src="/logo.png"
      alt="Terrenalv S.R.L."
      width={1380}
      height={170}
      priority={priority}
      className={variant === 'inverse' ? 'h-full w-auto' : className}
      style={variant === 'inverse' ? undefined : { height: '100%', width: 'auto' }}
    />
  );

  if (variant === 'inverse') {
    return (
      <span
        className={`inline-flex items-center rounded-lg bg-[#faf8f4] px-2 py-1 ${className ?? ''}`}
      >
        {img}
      </span>
    );
  }
  return <span className={`inline-flex items-center ${className ?? ''}`}>{img}</span>;
}

/** Square brand mark: the house-A glyph from the wordmark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/logo-mark.png"
      alt="Terrenalv"
      width={512}
      height={378}
      className={className}
    />
  );
}

export const LOGO_RATIO = RATIO;
