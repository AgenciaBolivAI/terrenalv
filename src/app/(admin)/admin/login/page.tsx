import type { Metadata } from 'next';
import { Suspense } from 'react';
import LoginClient from '@/features/admin/auth/LoginClient';

export const metadata: Metadata = {
  title: 'Ingresar al panel',
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  const hasEnv = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-black tracking-[0.2em] text-brand">TERRENALV</p>
          <p className="mt-1 text-sm text-stone-500">Panel del equipo — Estrellas del Sur</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          {hasEnv ? (
            <Suspense fallback={null}>
              <LoginClient />
            </Suspense>
          ) : (
            <p className="text-center text-sm text-stone-500">
              Sin conexión a la base de datos. Configura las variables de entorno de Supabase para
              habilitar el ingreso.
            </p>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-stone-400">
          Terrenalv S.R.L. — Santa Cruz, Bolivia
        </p>
      </div>
    </main>
  );
}
