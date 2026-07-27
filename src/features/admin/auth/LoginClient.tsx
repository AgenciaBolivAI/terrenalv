'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { btnPrimary, inputClass } from '@/features/admin/ui/bits';

function loginErrorCopy(message: string | undefined): string {
  if (!message) return 'No se pudo iniciar sesión. Intenta de nuevo.';
  if (message.includes('Invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (message.includes('Email not confirmed')) return 'Tu correo aún no está confirmado. Revisa tu bandeja.';
  if (message.includes('rate') || message.includes('Too many')) return 'Demasiados intentos. Espera unos minutos.';
  return 'No se pudo iniciar sesión. Intenta de nuevo.';
}

/**
 * Email+password login. Also handles the INVITE flow: Supabase invite links land
 * here with tokens in the URL hash; the browser client picks up the session and
 * we ask the new member to create their password.
 */
export default function LoginClient() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next');

  const [mode, setMode] = useState<'login' | 'set-password'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Invite / recovery links carry `type=invite|recovery` in the hash.
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const fromInvite = /type=(invite|recovery|signup)/.test(hash);
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setMode('set-password');
      else if (session && fromInvite) setMode('set-password');
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);
    if (err) {
      setError(loginErrorCopy(err.message));
      return;
    }
    const target = nextPath && nextPath.startsWith('/admin') ? nextPath : '/admin';
    router.replace(target);
    router.refresh();
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== password2) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) {
      setError('No se pudo guardar la contraseña. Abre de nuevo el enlace de invitación.');
      return;
    }
    router.replace('/admin');
    router.refresh();
  }

  if (mode === 'set-password') {
    return (
      <form onSubmit={handleSetPassword} className="space-y-4">
        <p className="text-sm text-stone-600">
          Bienvenido al equipo. Crea tu contraseña para entrar al panel.
        </p>
        <div>
          <label htmlFor="pw1" className="mb-1 block text-sm font-medium text-stone-700">
            Nueva contraseña
          </label>
          <input
            id="pw1"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="pw2" className="mb-1 block text-sm font-medium text-stone-700">
            Repite la contraseña
          </label>
          <input
            id="pw2"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className={inputClass}
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button type="submit" disabled={loading} className={`${btnPrimary} w-full`}>
          {loading ? 'Guardando…' : 'Guardar y entrar'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-stone-700">
          Correo electrónico
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="tu@correo.com"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-stone-700">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button type="submit" disabled={loading} className={`${btnPrimary} w-full`}>
        {loading ? 'Entrando…' : 'Entrar'}
      </button>
      <p className="text-center text-xs text-stone-400">
        Acceso solo por invitación. Si olvidaste tu contraseña, contacta a un administrador.
      </p>
    </form>
  );
}
