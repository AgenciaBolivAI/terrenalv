'use client';

// Claro / oscuro / automático para el panel.
//
// Tres estados, no dos: "auto" sigue al sistema, que es lo que hace que el
// panel se ponga oscuro solo cuando la computadora ya está en oscuro. Un
// interruptor de dos posiciones obliga a elegir a mano y a re-elegir en cada
// máquina.
//
// La preferencia se guarda en localStorage y se aplica sobre <html> antes del
// primer pintado (ver el script en el layout del panel), así no hay un
// parpadeo blanco al entrar.

import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'auto';

export const THEME_KEY = 'terrenalv-admin-theme';

/** Se comparte con el script inline del layout para no escribir la lógica dos veces. */
export function resolveTheme(pref: ThemePref, prefersDark: boolean): 'light' | 'dark' {
  if (pref === 'auto') return prefersDark ? 'dark' : 'light';
  return pref;
}

function IconSun({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" className={className ?? 'h-4 w-4'} aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function IconMoon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className ?? 'h-4 w-4'} aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
function IconAuto({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className ?? 'h-4 w-4'} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

const OPTIONS: { id: ThemePref; label: string; Icon: (p: { className?: string }) => React.ReactElement }[] = [
  { id: 'light', label: 'Claro', Icon: IconSun },
  { id: 'auto', label: 'Automático', Icon: IconAuto },
  { id: 'dark', label: 'Oscuro', Icon: IconMoon },
];

export function applyTheme(pref: ThemePref): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = resolveTheme(pref, prefersDark);
}

export default function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref>('auto');

  // El valor real vive en localStorage; el estado de React solo dibuja cuál
  // está activo. Se lee después del montaje para no romper la hidratación.
  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY) as ThemePref | null;
    if (saved === 'light' || saved === 'dark' || saved === 'auto') setPref(saved);
  }, []);

  // En automático hay que seguir al sistema mientras el panel está abierto, no
  // solo al cargarlo: alguien que cambia el tema del sistema a la noche espera
  // que el panel acompañe sin recargar.
  useEffect(() => {
    if (pref !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('auto');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  function choose(next: ThemePref) {
    setPref(next);
    window.localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tema del panel"
      className={`flex items-center gap-0.5 rounded-full border border-stone-200 bg-white p-0.5 ${className ?? ''}`}
    >
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={pref === id}
          aria-label={label}
          title={label}
          onClick={() => choose(id)}
          className={`cursor-pointer rounded-full p-1.5 transition-colors
                      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light ${
                        pref === id
                          ? 'bg-brand text-white'
                          : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700'
                      }`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
