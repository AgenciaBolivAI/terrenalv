import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import AdminShell from '@/features/admin/shell/AdminShell';
import SignOutButton from '@/features/admin/auth/SignOutButton';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { PROJECT_NAME } from '@/features/admin/lib/constants';

export const metadata: Metadata = {
  title: { default: 'Panel', template: '%s — Panel Terrenalv' },
  robots: { index: false, follow: false },
};

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4">
      <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
        <Logo className="h-7 w-auto" />
        <div className="mt-4 w-full">{children}</div>
      </div>
    </main>
  );
}

// Se ejecuta antes del primer pintado: si el tema se aplicara desde React, el
// panel aparecería blanco y recién después se pondría oscuro, que es un
// fogonazo en la cara de quien trabaja de noche.
const THEME_SCRIPT = `(function(){try{
var p=localStorage.getItem('terrenalv-admin-theme')||'auto';
var d=p==='dark'||(p==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.dataset.theme=d?'dark':'light';
}catch(e){}})();`;

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();

  if (!ctx.ok && ctx.reason === 'env') {
    return (
      <CenteredCard>
        <p className="text-sm font-medium text-stone-700">Sin conexión a la base de datos</p>
        <p className="mt-2 text-sm text-stone-500">
          Configura las variables de entorno de Supabase para habilitar el panel.
        </p>
      </CenteredCard>
    );
  }

  if (!ctx.ok && ctx.reason === 'auth') {
    redirect('/admin/login');
  }

  if (!ctx.ok) {
    // Signed in but no active team profile.
    return (
      <CenteredCard>
        <p className="text-sm font-medium text-stone-700">Cuenta sin acceso al panel</p>
        <p className="mt-2 text-sm text-stone-500">
          {ctx.reason === 'profile' && ctx.email ? (
            <>
              La cuenta <span className="font-medium">{ctx.email}</span> no tiene un perfil activo en
              el equipo. Contacta a un administrador.
            </>
          ) : (
            'Tu cuenta no tiene un perfil activo en el equipo. Contacta a un administrador.'
          )}
        </p>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </CenteredCard>
    );
  }

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <AdminShell
        profile={ctx.profile}
        projectId={ctx.project?.id ?? null}
        projectName={ctx.project?.name ?? PROJECT_NAME}
        projects={ctx.projects}
        activeSlug={ctx.project?.slug ?? null}
        currency={ctx.project?.currency ?? 'BOB'}
      >
        {children}
      </AdminShell>
    </>
  );
}
