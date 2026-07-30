import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Logo } from '@/components/Logo';
import LoginClient from '@/features/admin/auth/LoginClient';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export const metadata: Metadata = {
  title: 'Ingresar al panel',
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  const hasEnv = hasSupabaseConfig;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="h-9 w-auto" />
          <p className="mt-2 text-sm text-stone-500">Panel del equipo — Prados del Sur</p>
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
          Terrenalv S.R.L. — Santa Cruz, Bolivia ·{' '}
          <a
            href="https://bolivai.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-stone-600"
          >
            Made by BolivAI
          </a>
        </p>
      </div>
    </main>
  );
}
