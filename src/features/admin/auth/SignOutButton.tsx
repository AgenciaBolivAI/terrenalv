'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function SignOutButton({ className, children }: { className?: string; children?: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.href = '/admin/login';
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className={
        className ??
        'inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50'
      }
    >
      {children ?? (busy ? 'Cerrando…' : 'Cerrar sesión')}
    </button>
  );
}
