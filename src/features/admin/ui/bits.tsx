// Small shared admin UI pieces (server-safe: no hooks).

export function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-stone-500">
      <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="9" className="opacity-20" />
        <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
      </svg>
      {label ?? 'Cargando…'}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-10 text-center">
      <p className="text-sm font-medium text-stone-600">{title}</p>
      {hint ? <p className="mt-1 text-xs text-stone-400">{hint}</p> : null}
    </div>
  );
}

/**
 * Input styling WITHOUT a width — use this whenever the caller sets its own
 * (`w-32`, `flex-1`, …). Appending a width to a string that already contains
 * `w-full` leaves two competing utilities and CSS source order picks the
 * winner, not the order they were written. That is what made the buyer's
 * carnet field un-typeable, so the width is no longer baked in here.
 */
export const inputBase =
  'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand-light/30 disabled:bg-stone-100 disabled:text-stone-400';

/** The common case: fills its container. */
export const inputClass = `w-full ${inputBase}`;

// Shared by every button: a real press state, a visible keyboard focus ring,
// and a transition so the change reads as a response instead of a snap.
const btnBase =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors duration-150 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none';

export const btnPrimary = `${btnBase} bg-brand font-semibold text-white hover:bg-brand-light active:bg-emerald-800`;

/**
 * hover:bg-stone-50 used to be the hover here — the exact colour table rows go
 * on hover, so every secondary button inside a table looked dead: the row lit
 * up, the button changed by nothing. stone-100 reads against both the white
 * card and the hovered row.
 */
export const btnSecondary =
  `${btnBase} border border-stone-300 bg-white font-medium text-stone-700 ` +
  'hover:border-stone-400 hover:bg-stone-100 hover:text-stone-900 active:bg-stone-200';

export const btnDanger = `${btnBase} bg-red-600 font-semibold text-white hover:bg-red-700 active:bg-red-800`;
