'use client';

// Selector de urbanización en la barra superior.
//
// Con más de un proyecto, "Prados del Sur" escrito como texto fijo era una
// trampa: alguien podía estar cargando precios creyendo que trabajaba sobre
// otra urbanización. El nombre ahora dice cuál es Y permite cambiarla.
//
// Con un solo proyecto no se dibuja el desplegable — un selector de un elemento
// es ruido.

import { useState } from 'react';
import { PROJECT_COOKIE } from '@/features/admin/lib/constants';

export interface SwitchableProject {
  id: string;
  slug: string;
  name: string;
}

export default function ProjectSwitcher({
  projects,
  activeSlug,
  className,
}: {
  projects: SwitchableProject[];
  activeSlug: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = projects.find((p) => p.slug === activeSlug) ?? projects[0] ?? null;

  if (projects.length <= 1) {
    return (
      <p className={`truncate text-sm font-semibold text-stone-700 ${className ?? ''}`}>
        {active?.name ?? '—'}
      </p>
    );
  }

  function elegir(slug: string) {
    // Recarga completa a propósito: el proyecto se resuelve en el servidor, así
    // que media aplicación quedaría con datos del anterior si solo navegara.
    document.cookie = `${PROJECT_COOKIE}=${slug}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    window.location.href = '/admin';
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-56 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1
                   text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-100
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
      >
        <span className="truncate">{active?.name ?? 'Elegir urbanización'}</span>
        <span aria-hidden="true" className="text-xs text-stone-400">▾</span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <ul
            role="listbox"
            className="absolute left-0 z-50 mt-1 w-64 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-xl"
          >
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.slug === activeSlug}
                  onClick={() => elegir(p.slug)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm
                              transition-colors hover:bg-stone-50 ${
                                p.slug === activeSlug ? 'font-semibold text-brand' : 'text-stone-700'
                              }`}
                >
                  <span className="truncate">{p.name}</span>
                  {p.slug === activeSlug ? <span aria-hidden="true">✓</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
