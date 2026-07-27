'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { TeamRole } from '@/lib/db-types';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, EmptyState, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';

interface ProfileRow {
  id: string;
  full_name: string;
  role: TeamRole;
  phone: string | null;
  is_active: boolean;
  created_at: string;
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

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, phone, is_active, created_at')
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

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-stone-900">Equipo</h1>
        <button type="button" className={btnPrimary} onClick={() => setInviteOpen(true)}>
          Invitar
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
                <option value="admin">Administrador</option>
                <option value="ventas">Ventas</option>
              </select>
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

      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invitar al equipo">
        <div className="space-y-3">
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
            <option value="ventas">Ventas — verifica pagos y gestiona reservas</option>
            <option value="admin">Administrador — acceso total</option>
          </select>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <p className="text-xs text-stone-400">
            Recibirá un correo con un enlace para crear su contraseña y entrar al panel.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setInviteOpen(false)}>
            Volver
          </button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={() => void invite()}>
            {busy ? 'Enviando…' : 'Enviar invitación'}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
