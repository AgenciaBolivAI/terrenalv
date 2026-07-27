'use client';

// "Mi reserva" nav link: deep-links straight to the stored reservation when this
// device has one; otherwise goes to the search page.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getActiveReservation } from '@/lib/client/session-state';

export function MiReservaLink({ className, children }: { className?: string; children: React.ReactNode }) {
  const [href, setHref] = useState('/reserva');

  useEffect(() => {
    const stored = getActiveReservation();
    if (stored) setHref(`/reserva/${encodeURIComponent(stored.code)}`);
  }, []);

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
