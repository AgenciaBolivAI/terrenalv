'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Profile } from '@/lib/db-types';
import { Logo } from '@/components/Logo';
import SignOutButton from '@/features/admin/auth/SignOutButton';
import { ToastProvider } from '@/features/admin/ui/toast';
import {
  IconBell,
  IconCheck,
  IconGrid,
  IconHome,
  IconInbox,
  IconLogout,
  IconMap,
  IconMenu,
  IconScroll,
  IconLedger,
  IconRotate,
  IconChart,
  IconLayers,
  IconSettings,
  IconUsers,
  IconStore,
  IconExchange,
} from '@/features/admin/ui/icons';
import { AdminProvider } from './AdminContext';
import { puedeVer, seccionDe, type Acceso } from '@/features/admin/lib/acceso';
import type { TeamRole } from '@/lib/db-types';
import { ROLE_LABEL } from '@/features/admin/lib/roles';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';
import ProjectSwitcher, { type SwitchableProject } from './ProjectSwitcher';

interface NavItem {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  /** Roles que ven esta sección. Ausente = la ve todo el equipo. */
  roles?: TeamRole[];
}

/**
 * El menú, agrupado por lo que la persona vino a hacer.
 *
 * Dieciséis entradas en una sola tira son un muro: nadie encuentra «Planes de
 * pago» leyendo de arriba a abajo cada vez. Los títulos son los del oficio —
 * el mostrador, el mercado, el terreno, la plata, la empresa — no categorías
 * de software.
 */
const GRUPOS: { titulo: string; items: NavItem[] }[] = [
  {
    titulo: 'Mostrador',
    items: [
      { href: '/admin', label: 'Dashboard', icon: IconHome },
      { href: '/admin/reservas', label: 'Reservas', icon: IconInbox },
      { href: '/admin/ventas', label: 'Ventas', icon: IconCheck },
      { href: '/admin/clientes', label: 'Carteras', icon: IconUsers },
      // Los que se registraron en la web. Es otra cosa que «Clientes»:
      // ahí están los que COMPRARON; acá los que tienen CUENTA, hayan
      // comprado o no — que es justamente la lista para trabajar.
      { href: '/admin/cuentas', label: 'Cuentas', icon: IconUsers },
      { href: '/admin/notificaciones', label: 'Notificaciones', icon: IconBell },
      // Sin roles: es la pantalla del vendedor, que no entra a Contabilidad.
      { href: '/admin/mi-cuenta', label: 'Mi cuenta', icon: IconUsers },
    ],
  },
  {
    titulo: 'Cobranza',
    items: [
      // Contabilidad y Planes de pago van juntos porque son las dos mitades de
      // lo mismo: allá se registra el cobro, acá se ve el cronograma que ese
      // cobro va tachando.
      // Dos libros, dos entradas. El gerencial es la verdad del negocio; el
      // fiscal es lo que se declara, y se sirve del gerencial sin que el
      // gerencial sepa que existe.
      {
        href: '/admin/contabilidad',
        label: 'Contabilidad gerencial',
        icon: IconLedger,
        roles: ['admin', 'contabilidad'],
      },
      {
        href: '/admin/fiscal',
        label: 'Contabilidad fiscal',
        icon: IconScroll,
        roles: ['admin', 'contabilidad'],
      },
      {
        href: '/admin/inventario',
        label: 'Inventario de terrenos',
        icon: IconLayers,
        roles: ['admin', 'contabilidad'],
      },
      {
        href: '/admin/activos',
        label: 'Activos fijos',
        icon: IconGrid,
        roles: ['admin', 'contabilidad'],
      },
      {
        href: '/admin/planes',
        label: 'Planes de pago',
        icon: IconRotate,
        // El vendedor tambien: ve e imprime el plan de su cliente. Editar y
        // cobrar lo frenan el rol y el candado de la base, no el menu.
        roles: ['admin', 'contabilidad', 'ventas'],
      },
      {
        href: '/admin/comisiones',
        label: 'Comisiones',
        icon: IconUsers,
        roles: ['admin', 'contabilidad'],
      },
      {
        href: '/admin/financiamiento',
        label: 'Financiamiento',
        icon: IconLayers,
        roles: ['admin', 'contabilidad'],
      },
      {
        href: '/admin/analitica',
        label: 'Analítica',
        icon: IconChart,
        // El vendedor entra y ve LA SUYA (mi_analitica filtra en la base).
        roles: ['admin', 'contabilidad', 'ventas'],
      },
    ],
  },
  {
    titulo: 'Traspasos',
    items: [
      { href: '/admin/mercado', label: 'Mercado', icon: IconStore },
      { href: '/admin/traspasos', label: 'Traspasos', icon: IconExchange },
    ],
  },
  {
    titulo: 'Terreno',
    items: [
      { href: '/admin/lotes', label: 'Lotes', icon: IconGrid },
      { href: '/admin/mapa', label: 'Mapa', icon: IconMap, roles: ['admin'] },
      { href: '/admin/proyectos', label: 'Urbanizaciones', icon: IconLayers, roles: ['admin'] },
    ],
  },
  {
    titulo: 'Empresa',
    items: [
      { href: '/admin/equipo', label: 'Equipo', icon: IconUsers, roles: ['admin'] },
      {
        href: '/admin/rrhh',
        label: 'Recursos Humanos',
        icon: IconUsers,
        roles: ['admin', 'contabilidad'],
      },
      { href: '/admin/configuracion', label: 'Configuración', icon: IconSettings, roles: ['admin'] },
      { href: '/admin/auditoria', label: 'Auditoría', icon: IconScroll, roles: ['admin'] },
    ],
  },
];

/** La lista plana, para el móvil y para lo que necesite recorrerla entera. */
const NAV: NavItem[] = GRUPOS.flatMap((g) => g.items);


function isActive(pathname: string, href: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
}

export default function AdminShell({
  profile,
  projectId,
  projectName,
  projects,
  activeSlug,
  currency,
  acceso = null,
  children,
}: {
  profile: Profile;
  projectId: string | null;
  projectName: string;
  /** Todas las urbanizaciones administrables; alimenta el selector. */
  projects: SwitchableProject[];
  activeSlug: string | null;
  currency: 'USD' | 'BOB';
  /** Nivel efectivo por seccion (mi_acceso()); null = solo filtro por rol. */
  acceso?: Acceso | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [userMenu, setUserMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Dos filtros, en orden: el techo del ROL (lo que ese rol puede en la
  // base) y los PERMISOS por persona (los recortes que decidio el dueno).
  const visible = (item: NavItem) =>
    (!item.roles || item.roles.includes(profile.role)) &&
    puedeVer(acceso, seccionDe(item.href));
  const nav = NAV.filter(visible);
  // Un grupo sin nada que mostrar no se dibuja: un título suelto sin entradas
  // hace pensar que algo se rompió.
  const grupos = GRUPOS.map((g) => ({
    titulo: g.titulo,
    items: g.items.filter(visible),
  })).filter((g) => g.items.length > 0);

  // Si esta persona no tiene acceso a la seccion de la ruta actual, no se le
  // muestra el contenido — ni llegando por URL directa. El dato ademas esta
  // protegido en la base (rol + candados de solo-lectura); esto es la puerta.
  const seccionActual = seccionDe(pathname);
  const bloqueado = !puedeVer(acceso, seccionActual);
  const mobileMain = nav.slice(0, 3);
  const mobileMore = nav.slice(3);
  const roleLabel = ROLE_LABEL[profile.role] ?? profile.role;

  return (
    <AdminProvider value={{ profile, projectId, projectName, currency, acceso }}>
      <ToastProvider>
        <div className="admin-scope min-h-dvh bg-stone-100">
          {/* Desktop sidebar */}
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-stone-200 bg-white md:flex">
            <div className="px-5 py-5">
              {/* El logo es lo primero que se toca para volver al sitio. */}
              <Link
                href="/"
                aria-label="Ir al sitio de Terrenalv"
                title="Ir al sitio"
                className="admin-logo inline-flex rounded-lg transition-opacity hover:opacity-80
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
              >
                <Logo className="h-7 w-auto" />
              </Link>
              <p className="mt-1 text-xs text-stone-500">{projectName}</p>
            </div>
            {/* min-h-0 + overflow-y-auto: con dieciséis secciones el menú es
                más alto que una laptop, y sin esto las últimas —Planes de
                pago, Analítica, Configuración— quedaban cortadas abajo, sin
                forma de llegar a ellas. */}
            <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
              {grupos.map((g) => (
                <div key={g.titulo} className="space-y-1">
                  <p className="px-3 pt-1 text-[10px] font-bold tracking-wider text-stone-400 uppercase">
                    {g.titulo}
                  </p>
                  {g.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                        isActive(pathname, item.href)
                          ? 'bg-green-50 text-brand'
                          : 'text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
            <div className="border-t border-stone-100 p-4">
              <p className="truncate text-sm font-medium text-stone-800">{profile.full_name}</p>
              <p className="text-xs text-stone-400">{roleLabel}</p>
              <SignOutButton className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
                <IconLogout className="h-4 w-4" /> Cerrar sesión
              </SignOutButton>
              <p className="mt-3 text-center text-[10px] text-stone-400">
                <a
                  href="https://bolivai.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-stone-600"
                >
                  Made by BolivAI
                </a>
              </p>
            </div>
          </aside>

          {/* Content column */}
          <div className="flex min-h-dvh flex-col md:pl-60">
            <header className="admin-topbar sticky top-0 z-30 flex h-14 items-center justify-between border-b border-stone-200 px-4 backdrop-blur">
              <div className="min-w-0 md:hidden">
                <Link
                  href="/"
                  aria-label="Ir al sitio de Terrenalv"
                  title="Ir al sitio"
                  className="admin-logo inline-flex rounded-lg transition-opacity hover:opacity-80
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                >
                  <Logo className="h-5 w-auto" srl={false} />
                </Link>
                <p className="truncate text-[11px] text-stone-500">{projectName}</p>
              </div>
              <ProjectSwitcher
                projects={projects}
                activeSlug={activeSlug}
                className="hidden md:block"
              />
              <div className="flex items-center gap-2">
                <ThemeToggle className="hidden sm:flex" />
                <NotificationBell />
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setUserMenu((o) => !o)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-white"
                    aria-label="Menú de usuario"
                  >
                    {profile.full_name.trim().charAt(0).toUpperCase() || 'U'}
                  </button>
                  {userMenu ? (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setUserMenu(false)} aria-hidden />
                      <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-stone-200 bg-white p-3 shadow-xl">
                        <p className="truncate text-sm font-semibold text-stone-800">
                          {profile.full_name}
                        </p>
                        <p className="text-xs text-stone-400">{roleLabel}</p>
                        <div className="mt-3 sm:hidden">
                          <p className="mb-1.5 text-xs text-stone-500">Tema</p>
                          <ThemeToggle />
                        </div>
                        <div className="mt-3">
                          <SignOutButton className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
                            <IconLogout className="h-4 w-4" /> Cerrar sesión
                          </SignOutButton>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </header>

            <main className="flex-1 px-3 pb-24 pt-4 sm:px-5 md:pb-8">
              {bloqueado ? (
                <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center">
                  <p className="text-sm font-semibold text-stone-800">
                    No tenés acceso a esta sección
                  </p>
                  <p className="mt-2 text-xs text-stone-500">
                    Tu cuenta no tiene habilitado este módulo. Si lo necesitás,
                    pedile al administrador que te lo habilite en Equipo.
                  </p>
                </div>
              ) : (
                children
              )}
            </main>
          </div>

          {/* Mobile bottom tab bar */}
          <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
            {mobileMain.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                  isActive(pathname, item.href) ? 'text-brand' : 'text-stone-500'
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-stone-500"
            >
              <IconMenu className="h-5 w-5" />
              Más
            </button>
          </nav>

          {/* Mobile "Más" sheet */}
          {moreOpen ? (
            <div className="fixed inset-0 z-[60] md:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} aria-hidden />
              <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200" />
                <p className="mb-1 px-1 text-sm font-semibold text-stone-800">{profile.full_name}</p>
                <p className="mb-3 px-1 text-xs text-stone-400">{roleLabel}</p>
                <div className="max-h-[55vh] space-y-3 overflow-y-auto">
                  {grupos.map((g) => {
                    const items = g.items.filter((i) =>
                      mobileMore.some((m) => m.href === i.href),
                    );
                    if (items.length === 0) return null;
                    return (
                      <div key={g.titulo}>
                        <p className="px-1 pb-1 text-[10px] font-bold tracking-wider text-stone-400 uppercase">
                          {g.titulo}
                        </p>
                        <ul className="space-y-1">
                          {items.map((item) => (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                onClick={() => setMoreOpen(false)}
                                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                                  isActive(pathname, item.href)
                                    ? 'bg-green-50 text-brand'
                                    : 'text-stone-700 hover:bg-stone-50'
                                }`}
                              >
                                <item.icon className="h-5 w-5" />
                                {item.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 border-t border-stone-100 pt-3">
                  <SignOutButton className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50">
                    <IconLogout className="h-4 w-4" /> Cerrar sesión
                  </SignOutButton>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </ToastProvider>
    </AdminProvider>
  );
}
