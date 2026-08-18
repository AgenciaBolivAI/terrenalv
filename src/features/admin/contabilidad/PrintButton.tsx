'use client';

// window.print() needs a client component; the receipt itself stays a server
// component so it renders with no JavaScript at all if printing is not wanted.

import { btnPrimary } from '@/features/admin/ui/bits';

export function PrintButton() {
  return (
    <button type="button" className={btnPrimary} onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
