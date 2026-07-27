// Branded chrome shared by every buyer-facing reservation page (/reservar/[lotId],
// /reserva and /reserva/[code]). These links get forwarded on WhatsApp, so the
// Terrenalv wordmark has to be the first thing the buyer sees and the page has to
// close with who built it. Deliberately a server component (no 'use client') so
// RSC pages can wrap their content in it directly.

import Link from 'next/link';
import { Logo } from '@/components/Logo';

export function PublicShell({
  children,
  maxWidth = 'max-w-md',
}: {
  children: React.ReactNode;
  /** Tailwind max-width class for the header, body and footer rails. */
  maxWidth?: string;
}) {
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-stone-200 bg-white">
        <div className={`mx-auto w-full ${maxWidth} px-4 py-2.5`}>
          <Link href="/" aria-label="Ir al inicio de Terrenalv" className="inline-block">
            <Logo className="h-6 w-auto" />
          </Link>
        </div>
      </header>

      <div className={`mx-auto w-full flex-1 ${maxWidth} px-4 pb-16 pt-4`}>{children}</div>

      <footer className="mt-auto border-t border-stone-200">
        <p className={`mx-auto w-full ${maxWidth} px-4 py-5 text-center text-xs text-stone-400`}>
          © {new Date().getFullYear()} Terrenalv S.R.L.
          <span className="mx-2">·</span>
          <a
            href="https://bolivai.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-stone-600"
          >
            Made by BolivAI
          </a>
        </p>
      </footer>
    </main>
  );
}
