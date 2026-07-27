// Terrenalv brand palette, in plain hex, for contexts that cannot read the CSS
// custom properties in globals.css (emails, canvas/SVG generation, image jobs).
// Keep these in sync with `--brand-*` in src/app/globals.css and src/components/Logo.tsx.

export const BRAND = {
  green: '#14532d',
  greenLight: '#16a34a',
  brown: '#7c4f2c',
  leaf: '#22c55e',
} as const;
