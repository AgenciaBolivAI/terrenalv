'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { TeamRole } from '@/lib/db-types';
import { ALL_ROLES, ROLE_HINT, ROLE_LABEL } from '@/features/admin/lib/roles';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, EmptyState, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import PermisosDialog from './PermisosDialog';

interface ProfileRow {
  id: string;
  full_name: string;
  role: TeamRole;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  /** Recortes por persona debajo del techo del rol (secciones tocadas a mano). */
  permisos: Record<string, string> | null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function TeamClient({ selfId }: { selfId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();

  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<TeamRole>('ventas');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [permisosDe, setPermisosDe] = useState<ProfileRow | null>(null);
  // Dos formas de sumar a alguien: mandarle un correo, o crearle la cuenta
  // lista con una contrasena. La segunda no depende de que el correo llegue.
  const [modo, setModo] = useState<'invitar' | 'crear'>('invitar');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, phone, is_active, created_at, permisos')
      .order('created_at', { ascending: true });
    setRows((data ?? []) as ProfileRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setMember(p: ProfileRow, nextRole: TeamRole, nextActive: boolean) {
    const { error: err } = await supabase.rpc('set_team_member', {
      p_user_id: p.id,
      p_role: nextRole,
      p_is_active: nextActive,
    });
    if (err) {
      push(adminErrorCopy(err.message), 'error');
      return;
    }
    push('Perfil actualizado.', 'success');
    void load();
  }

  async function invite() {
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setError('Correo inválido.');
      return;
    }
    if (fullName.trim().length < 3) {
      setError('Escribe el nombre completo.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), full_name: fullName.trim(), role }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? 'No se pudo enviar la invitación.');
        return;
      }
      push(`Invitación enviada a ${email.trim()}.`, 'success');
      setInviteOpen(false);
      setEmail('');
      setFullName('');
      setRole('ventas');
      void load();
    } catch {
      setError('No se pudo enviar la invitación. Revisa tu conexión.');
    } finally {
      setBusy(false);
    }
  }

  async function crearConPassword() {
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setError('Correo invalido.');
      return;
    }
    if (fullName.trim().length < 3) {
      setError('Escribe el nombre completo.');
      return;
    }
    if (password.length < 8) {
      setError('La contrase\u00f1a necesita al menos 8 caracteres.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/crear-cuenta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          full_name: fullName.trim(),
          role,
          password,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? 'No se pudo crear la cuenta.');
        return;
      }
      push(`Cuenta creada para ${email.trim()}. Ya puede entrar.`, 'success');
      setInviteOpen(false);
      setEmail('');
      setFullName('');
      setPassword('');
      setRole('ventas');
      void load();
    } catch {
      setError('No se pudo crear la cuenta. Revisa tu conexion.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-stone-900">Equipo</h1>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            setError(null);
            setPassword('');
            setInviteOpen(true);
          }}
        >
          Sumar a alguien
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-14">
          <Spinner label="Cargando equipo…" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Sin miembros" hint="Invita al primer miembro del equipo." />
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-900">
                  {p.full_name}
                  {p.id === selfId ? <span className="ml-1 text-xs text-stone-400">(tú)</span> : null}
                </p>
                <p className="text-xs text-stone-500">{p.phone ?? 'sin teléfono'}</p>
              </div>
              {!p.is_active ? <Badge className="bg-stone-200 text-stone-600">Inactivo</Badge> : null}
              <select
                value={p.role}
                onChange={(e) => void setMember(p, e.target.value as TeamRole, p.is_active)}
                className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                aria-label={`Rol de ${p.full_name}`}
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              {p.role !== 'admin' ? (
                <button
                  type="button"
                  onClick={() => setPermisosDe(p)}
                  className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                  title="Qué secciones ve y cuáles puede tocar"
                >
                  Permisos
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void setMember(p, p.role, !p.is_active)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                  p.is_active
                    ? 'border border-stone-200 text-stone-600 hover:bg-stone-50'
                    : 'bg-brand text-white hover:bg-brand-light'
                }`}
              >
                {p.is_active ? 'Desactivar' : 'Activar'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {permisosDe ? (
        <PermisosDialog
          profileId={permisosDe.id}
          nombre={permisosDe.full_name}
          permisos={permisosDe.permisos ?? {}}
          onClose={() => setPermisosDe(null)}
          onSaved={() => {
            setPermisosDe(null);
            void load();
          }}
        />
      ) : null}

      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} title="Sumar a alguien al equipo">
        <div className="space-y-3">
          {/* Dos caminos. El de la contrasena existe porque el correo a veces
              no llega, o la persona todavia no controla esa casilla. */}
          <div className="flex gap-1 rounded-xl border border-stone-200 bg-stone-50 p-1">
            <button
              type="button"
              onClick={() => {
                setModo('invitar');
                setError(null);
              }}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
                modo === 'invitar' ? 'bg-white text-brand shadow-sm' : 'text-stone-600'
              }`}
            >
              Invitar por correo
            </button>
            <button
              type="button"
              onClick={() => {
                setModo('crear');
                setError(null);
              }}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
                modo === 'crear' ? 'bg-white text-brand shadow-sm' : 'text-stone-600'
              }`}
            >
              Crear con contrase\u00f1a
            </button>
          </div>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.com"
            className={inputClass}
          />
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Nombre completo"
            className={inputClass}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)} className={inputClass}>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          {/* Qué implica el rol elegido, ahí mismo: elegir entre tres nombres
              sin saber qué abre cada uno es cómo se reparte de más por las dudas. */}
          <p className="rounded-lg bg-stone-50 p-2.5 text-xs text-stone-600">{ROLE_HINT[role]}</p>

          {modo === 'crear' ? (
            <div>
              <div className="flex gap-2">
                <input
                  type={verPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Contrase\u00f1a inicial"
                  autoComplete="new-password"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setVerPassword((v) => !v)}
                  className="shrink-0 rounded-lg border border-stone-200 px-3 text-xs font-medium text-stone-600 hover:bg-stone-50"
                >
                  {verPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
              <p className="mt-1 text-xs text-stone-400">
                M\u00ednimo 8 caracteres. Se la ten\u00e9s que pasar vos por un medio seguro \u2014 el
                sistema no la guarda en ning\u00fan lado ni la vuelve a mostrar.
              </p>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <p className="text-xs text-stone-400">
            {modo === 'invitar'
              ? 'Recibir\u00e1 un correo con un enlace para crear su contrase\u00f1a y entrar al panel.'
              : 'La cuenta queda lista al instante: entra con ese correo y esa contrase\u00f1a, sin esperar ning\u00fan mail. Convien\u00e9 que la cambie en cuanto entre.'}
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setInviteOpen(false)}>
            Volver
          </button>
          <button
            type="button"
            disabled={busy}
            className={btnPrimary}
            onClick={() => void (modo === 'crear' ? crearConPassword() : invite())}
          >
            {busy
              ? modo === 'crear'
                ? 'Creando…'
                : 'Enviando…'
              : modo === 'crear'
                ? 'Crear cuenta'
                : 'Enviar invitación'}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
