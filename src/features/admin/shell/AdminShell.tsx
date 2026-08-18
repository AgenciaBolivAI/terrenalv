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
  IconGrid,
  IconHome,
  IconInbox,
  IconLogout,
  IconMap,
  IconMenu,
  IconScroll,
  IconLedger,
  IconSettings,
  IconUsers,
} from '@/features/admin/ui/icons';
import { AdminProvider } from './AdminContext';
import NotificationBell from './NotificationBell';

interface NavItem {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: IconHome },
  { href: '/admin/reservas', label: 'Reservas', icon: IconInbox },
  { href: '/admin/lotes', label: 'Lotes', icon: IconGrid },
  { href: '/admin/notificaciones', label: 'Notificaciones', icon: IconBell },
  { href: '/admin/contabilidad', label: 'Contabilidad', icon: IconLedger, adminOnly: true },
  { href: '/admin/mapa', label: 'Mapa', icon: IconMap, adminOnly: true },
  { href: '/admin/equipo', label: 'Equipo', icon: IconUsers, adminOnly: true },
  { href: '/admin/configuracion', label: 'Configuración', icon: IconSettings, adminOnly: true },
  { href: '/admin/auditoria', label: 'Auditoría', icon: IconScroll, adminOnly: true },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
}

export default function AdminShell({
  profile,
  projectId,
  projectName,
  currency,
  children,
}: {
  profile: Profile;
  projectId: string | null;
  projectName: string;
  currency: 'USD' | 'BOB';
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [userMenu, setUserMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const nav = NAV.filter((item) => !item.adminOnly || profile.role === 'admin');
  const mobileMain = nav.slice(0, 3);
  const mobileMore = nav.slice(3);
  const roleLabel = profile.role === 'admin' ? 'Administrador' : 'Ventas';

  return (
    <AdminProvider value={{ profile, projectId, projectName, currency }}>
      <ToastProvider>
        <div className="min-h-dvh bg-stone-100">
          {/* Desktop sidebar */}
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-stone-200 bg-white md:flex">
            <div className="px-5 py-5">
              <Logo className="h-7 w-auto" />
              <p className="mt-1 text-xs text-stone-500">{projectName}</p>
            </div>
            <nav className="flex-1 space-y-1 px-3">
              {nav.map((item) => (
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
            <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-stone-200 bg-white/95 px-4 backdrop-blur">
              <div className="min-w-0 md:hidden">
                <Logo className="h-5 w-auto" srl={false} />
                <p className="truncate text-[11px] text-stone-500">{projectName}</p>
              </div>
              <p className="hidden text-sm font-semibold text-stone-700 md:block">{projectName}</p>
              <div className="flex items-center gap-1">
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

            <main className="flex-1 px-3 pb-24 pt-4 sm:px-5 md:pb-8">{children}</main>
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
                <ul className="space-y-1">
                  {mobileMore.map((item) => (
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
