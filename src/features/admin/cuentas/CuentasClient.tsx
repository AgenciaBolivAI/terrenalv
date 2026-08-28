'use client';

// Los clientes REGISTRADOS: quiénes se dieron de alta, cuántos llegaron a
// comprar, y a quiénes hay que saludar este mes.
//
// Cada tile filtra la lista de abajo. Un número sin manera de llegar a la
// gente que cuenta no sirve para nada: si dice «12 cumplen este mes», hay que
// poder ver los doce y escribirles.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, waLink } from '@/lib/format';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { EmptyState, Spinner } from '@/features/admin/ui/bits';
import { ExportButtons } from '@/features/admin/export/ExportButtons';

interface Cliente {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  ci: string | null;
  city: string | null;
  birth_date: string | null;
  como_nos_conocio: string | null;
  marketing_opt_in: boolean;
  fecha_registro: string;
  compras: number;
  invertido: number;
  saldo: number;
  es_comprador: boolean;
  cumple_este_mes: boolean;
  aniversario_este_mes: boolean;
  primera_compra: string | null;
}

interface Resumen {
  registrados: number;
  este_mes: number;
  compradores: number;
  sin_comprar: number;
  con_permiso_email: number;
  cumplen_este_mes: number;
  aniversario_mes: number;
  compras_vinculadas: number;
  compras_sin_cuenta: number;
  por_mes: { mes: string; altas: number }[];
  como_nos_conocio: { origen: string; cuantos: number }[];
}

type Filtro =
  | 'todos'
  | 'este_mes'
  | 'compradores'
  | 'sin_comprar'
  | 'con_permiso'
  | 'cumple'
  | 'aniversario';

const ETIQUETA: Record<Filtro, string> = {
  todos: 'Todos los registrados',
  este_mes: 'Se registraron este mes',
  compradores: 'Ya compraron',
  sin_comprar: 'Registrados sin comprar',
  con_permiso: 'Aceptan recibir correos',
  cumple: 'Cumplen años este mes',
  aniversario: 'Aniversario de compra este mes',
};

export default function CuentasClient() {
  const supabase = useMemo(() => createClient(), []);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [q, setQ] = useState('');

  const cargar = useCallback(async () => {
    const [c, r] = await Promise.all([
      supabase.from('v_clientes_cuenta').select('*').order('created_at', { ascending: false }),
      supabase.rpc('an_clientes_resumen'),
    ]);
    setClientes((c.data ?? []) as unknown as Cliente[]);
    setResumen((r.data as unknown as Resumen) ?? null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const mesInicio = new Date();
  mesInicio.setDate(1);
  const desdeMes = mesInicio.toISOString().slice(0, 10);

  const visibles = clientes.filter((c) => {
    if (filtro === 'este_mes' && c.fecha_registro < desdeMes) return false;
    if (filtro === 'compradores' && !c.es_comprador) return false;
    if (filtro === 'sin_comprar' && c.es_comprador) return false;
    if (filtro === 'con_permiso' && !c.marketing_opt_in) return false;
    if (filtro === 'cumple' && !c.cumple_este_mes) return false;
    if (filtro === 'aniversario' && !c.aniversario_este_mes) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return (
      c.full_name.toLowerCase().includes(t) ||
      c.email.toLowerCase().includes(t) ||
      (c.phone ?? '').includes(t) ||
      (c.ci ?? '').toLowerCase().includes(t) ||
      (c.city ?? '').toLowerCase().includes(t)
    );
  });

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const tiles: { id: Filtro; label: string; valor: number; pista: string }[] = [
    { id: 'todos', label: 'Registrados', valor: resumen?.registrados ?? 0, pista: 'cuentas creadas' },
    { id: 'este_mes', label: 'Nuevos este mes', valor: resumen?.este_mes ?? 0, pista: 'altas del mes' },
    { id: 'compradores', label: 'Ya compraron', valor: resumen?.compradores ?? 0, pista: 'con al menos un lote' },
    { id: 'sin_comprar', label: 'Sin comprar', valor: resumen?.sin_comprar ?? 0, pista: 'la lista para trabajar' },
    { id: 'con_permiso', label: 'Aceptan correos', valor: resumen?.con_permiso_email ?? 0, pista: 'se les puede escribir' },
    { id: 'cumple', label: 'Cumplen este mes', valor: resumen?.cumplen_este_mes ?? 0, pista: 'para saludar' },
    { id: 'aniversario', label: 'Aniversario del mes', valor: resumen?.aniversario_mes ?? 0, pista: 'de su compra' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFiltro(t.id)}
            title={`Ver ${t.pista}`}
            className={`rounded-xl border p-3 text-left transition ${
              filtro === t.id
                ? 'border-brand bg-green-50'
                : 'border-stone-200 bg-white hover:border-stone-300'
            }`}
          >
            <p className="text-[11px] tracking-wide text-stone-500 uppercase">{t.label}</p>
            <p className="text-xl font-black tabular-nums text-stone-900">{t.valor}</p>
            <p className="text-[11px] text-stone-400">{t.pista}</p>
          </button>
        ))}
      </div>

      {/* Las compras que todavía no tienen dueño con cuenta: la lista de a
          quién invitar a registrarse. */}
      {resumen && resumen.compras_sin_cuenta > 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>{resumen.compras_sin_cuenta}</strong>{' '}
          {resumen.compras_sin_cuenta === 1 ? 'venta confirmada no está' : 'ventas confirmadas no están'}{' '}
          vinculada{resumen.compras_sin_cuenta === 1 ? '' : 's'} a ninguna cuenta.{' '}
          {resumen.compras_vinculadas} ya {resumen.compras_vinculadas === 1 ? 'lo está' : 'lo están'}.
          Cada comprador las vincula con su código de seguimiento desde{' '}
          <span className="font-mono">/cuenta</span>.
        </p>
      ) : null}

      {resumen && resumen.como_nos_conocio.length > 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-3">
          <p className="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
            Cómo nos conocieron
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-700">
            {resumen.como_nos_conocio.map((o) => (
              <li key={o.origen}>
                {o.origen} <strong className="tabular-nums">{o.cuantos}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, correo, celular, carnet o ciudad"
          className="w-full max-w-md rounded-lg border border-stone-300 px-3 py-1.5 text-sm sm:w-auto sm:flex-1"
        />
        <span className="text-xs text-stone-500">
          {ETIQUETA[filtro]} — {visibles.length}
        </span>
        <div className="ml-auto">
          <ExportButtons
            meta={{
              title: `Clientes registrados — ${ETIQUETA[filtro]}`,
              subtitle: `${visibles.length} persona${visibles.length === 1 ? '' : 's'}`,
              filename: `clientes-${filtro}-${new Date().toISOString().slice(0, 10)}`,
              footnote:
                'Solo se le escribe a quien aceptó recibir correos. «Invertido» es lo que pagó ' +
                'contra el precio de sus lotes; «Saldo» lo que le falta.',
            }}
            columns={[
              { header: 'Nombre' },
              { header: 'Correo' },
              { header: 'Celular' },
              { header: 'Carnet' },
              { header: 'Ciudad' },
              { header: 'Nacimiento' },
              { header: 'Cómo nos conoció' },
              { header: 'Acepta correos' },
              { header: 'Registrado' },
              { header: 'Compras', align: 'right' },
              { header: 'Invertido', align: 'right' },
              { header: 'Saldo', align: 'right' },
            ]}
            rows={() =>
              visibles.map((c) => [
                c.full_name,
                c.email,
                c.phone ?? '',
                c.ci ?? '',
                c.city ?? '',
                c.birth_date ? dateLabel(c.birth_date) : '',
                c.como_nos_conocio ?? '',
                c.marketing_opt_in ? 'Sí' : 'No',
                dateLabel(c.fecha_registro),
                c.compras,
                Number(c.invertido),
                Number(c.saldo),
              ])
            }
          />
        </div>
      </div>

      {visibles.length === 0 ? (
        <EmptyState
          title="Nadie por acá todavía"
          hint={
            clientes.length === 0
              ? 'Cuando los compradores creen su cuenta en /cuenta van a aparecer en esta lista.'
              : 'Probá con otro filtro o limpiá la búsqueda.'
          }
        />
      ) : (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {visibles.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="font-semibold text-stone-900">{c.full_name}</span>
              {c.cumple_este_mes ? (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                  cumple este mes
                </span>
              ) : null}
              {c.aniversario_este_mes ? (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                  aniversario
                </span>
              ) : null}
              {!c.marketing_opt_in ? (
                <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] text-stone-600">
                  sin permiso de correo
                </span>
              ) : null}
              <span className="text-xs text-stone-500">{c.email}</span>
              {c.city ? <span className="text-xs text-stone-400">{c.city}</span> : null}
              <span className="ml-auto text-xs text-stone-500">
                {c.compras > 0
                  ? `${c.compras} lote${c.compras === 1 ? '' : 's'} · ${formatMoney(Number(c.invertido), 'BOB')}`
                  : 'sin comprar'}
              </span>
              <span className="text-xs text-stone-400">alta {dateLabel(c.fecha_registro)}</span>
              {c.phone ? (
                <a
                  href={waLink(c.phone, `Hola ${c.full_name.split(' ')[0] ?? ''}, te escribimos de Terrenalv.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-green-700"
                >
                  WhatsApp
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
