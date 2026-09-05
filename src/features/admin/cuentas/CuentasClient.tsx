'use client';

// La misma gente que Clientes, pero SIN PLATA.
//
// Antes esta pantalla listaba únicamente a quienes se habían creado una cuenta
// en la web —hoy, nadie— así que estaba vacía mientras la oficina tenía 20
// clientes de verdad. Ahora muestra a las mismas personas que Clientes: quién
// es, dónde vive y cómo se llega hasta él.
//
// De la compra sólo se dice CÓMO la pagó (contado, crédito, traspaso) y CUÁNDO.
// Ni precio, ni pagado, ni saldo, ni recibos. Y no es que se oculten en la
// pantalla: se leen `v_clientes_ficha` y `v_cliente_actividad_ficha`, que no
// tienen columnas de plata — hay un guardián (`la_ficha_de_cuentas_no_muestra_plata`)
// que se pone rojo si alguien le agrega una.
//
// Cada tile filtra la lista de abajo: un número sin manera de llegar a la
// gente que cuenta no sirve para nada.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { waLink } from '@/lib/format';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { EmptyState, Spinner } from '@/features/admin/ui/bits';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { traerTodo } from '@/features/admin/lib/traer-todo';
import { hoyBolivia } from '@/features/admin/lib/lapaz';
import { FichaClienteDialog } from '@/features/admin/clientes/FichaClienteDialog';
import { consultaDeMapa, enlaceDeMapa } from '@/features/admin/clientes/FichaContacto';

interface ClienteFicha {
  ci_norm: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string | null;
  buyer_email: string | null;
  lotes_comprados: number;
  reservas_totales: number;
  lotes_reservados: number;
  proyectos: number;
  primera_actividad: string;
  ultima_actividad: string | null;
  direccion: string | null;
  referencias: string | null;
  ubicacion: string | null;
  nota: string | null;
  city: string | null;
  como_nos_conocio: string | null;
  marketing_opt_in: boolean;
  correo_verificado: boolean;
  fecha_registro: string | null;
  modalidades: string | null;
  primera_compra: string | null;
  ultima_compra: string | null;
}

type Filtro =
  | 'todos'
  | 'contado'
  | 'credito'
  | 'traspaso'
  | 'sin_plan'
  | 'con_direccion'
  | 'sin_direccion';

const ETIQUETA: Record<Filtro, string> = {
  todos: 'Todos los clientes',
  contado: 'Compraron al contado',
  credito: 'Compraron a crédito',
  traspaso: 'Recibieron por traspaso',
  sin_plan: 'Compraron sin plan de cuotas',
  con_direccion: 'Con dirección cargada',
  sin_direccion: 'Sin dirección cargada',
};

/** Un cliente «es» de una modalidad si alguna de sus compras lo fue. */
function tiene(c: ClienteFicha, modalidad: string): boolean {
  return (c.modalidades ?? '').includes(modalidad);
}

const BADGE_MODALIDAD: Record<string, string> = {
  Contado: 'bg-green-100 text-green-800',
  Crédito: 'bg-sky-100 text-sky-800',
  Traspaso: 'bg-violet-100 text-violet-800',
  'Sin plan': 'bg-amber-100 text-amber-800',
};

export default function CuentasClient() {
  const supabase = useMemo(() => createClient(), []);
  const [clientes, setClientes] = useState<ClienteFicha[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [q, setQ] = useState('');
  const [ficha, setFicha] = useState<ClienteFicha | null>(null);

  const cargar = useCallback(async () => {
    const filas = await traerTodo<ClienteFicha>((desde, hasta) =>
      supabase
        .from('v_clientes_ficha')
        .select('*')
        .order('ci_norm', { ascending: true })
        .range(desde, hasta),
    );
    // Se pagina por `ci_norm` porque es único y estable —sin un orden único,
    // dos páginas repiten una fila y se saltean otra— pero se MUESTRA por
    // nombre, que es como la oficina busca a una persona.
    filas.sort((a, b) => a.buyer_full_name.localeCompare(b.buyer_full_name, 'es'));
    setClientes(filas);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = clientes.filter((c) => {
    if (filtro === 'contado' && !tiene(c, 'Contado')) return false;
    if (filtro === 'credito' && !tiene(c, 'Crédito')) return false;
    if (filtro === 'traspaso' && !tiene(c, 'Traspaso')) return false;
    if (filtro === 'sin_plan' && !tiene(c, 'Sin plan')) return false;
    if (filtro === 'con_direccion' && !c.direccion) return false;
    if (filtro === 'sin_direccion' && c.direccion) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return (
      c.buyer_full_name.toLowerCase().includes(t) ||
      (c.buyer_email ?? '').toLowerCase().includes(t) ||
      (c.buyer_phone ?? '').includes(t) ||
      c.buyer_ci.toLowerCase().includes(t) ||
      (c.direccion ?? '').toLowerCase().includes(t) ||
      (c.referencias ?? '').toLowerCase().includes(t) ||
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
    { id: 'todos', label: 'Clientes', valor: clientes.length, pista: 'personas con movimientos' },
    {
      id: 'contado',
      label: 'Al contado',
      valor: clientes.filter((c) => tiene(c, 'Contado')).length,
      pista: 'pagaron todo',
    },
    {
      id: 'credito',
      label: 'A crédito',
      valor: clientes.filter((c) => tiene(c, 'Crédito')).length,
      pista: 'pagan en cuotas',
    },
    {
      id: 'traspaso',
      label: 'Por traspaso',
      valor: clientes.filter((c) => tiene(c, 'Traspaso')).length,
      pista: 'les cedieron el lote',
    },
    {
      id: 'sin_plan',
      label: 'Sin plan',
      valor: clientes.filter((c) => tiene(c, 'Sin plan')).length,
      pista: 'deben y no tienen cuotas',
    },
    {
      id: 'con_direccion',
      label: 'Con dirección',
      valor: clientes.filter((c) => c.direccion).length,
      pista: 'sabemos dónde viven',
    },
    {
      id: 'sin_direccion',
      label: 'Sin dirección',
      valor: clientes.filter((c) => !c.direccion).length,
      pista: 'falta cargarla',
    },
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

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, carnet, celular, correo o dirección"
          className="w-full max-w-md rounded-lg border border-stone-300 px-3 py-1.5 text-sm sm:w-auto sm:flex-1"
        />
        <span className="text-xs text-stone-500">
          {ETIQUETA[filtro]} — {visibles.length}
        </span>
        <div className="ml-auto">
          <ExportButtons
            meta={{
              title: `Clientes — ${ETIQUETA[filtro]}`,
              subtitle: `${visibles.length} persona${visibles.length === 1 ? '' : 's'}`,
              filename: `clientes-ficha-${filtro}-${hoyBolivia()}`,
              footnote:
                'Ficha del cliente: quién es y dónde vive. De la compra sólo la modalidad y la ' +
                'fecha — los importes se ven en Clientes.',
            }}
            columns={[
              { header: 'Nombre' },
              { header: 'Carnet' },
              { header: 'Celular' },
              { header: 'Correo' },
              { header: 'Dirección' },
              { header: 'Referencias' },
              { header: 'Ubicación' },
              { header: 'Ciudad' },
              { header: 'Lotes', align: 'right' },
              { header: 'Cómo compró' },
              { header: 'Primera compra' },
              { header: 'Última compra' },
            ]}
            rows={() =>
              visibles.map((c) => [
                c.buyer_full_name,
                c.buyer_ci,
                c.buyer_phone ?? '',
                c.buyer_email ?? '',
                c.direccion ?? '',
                c.referencias ?? '',
                c.ubicacion ?? '',
                c.city ?? '',
                c.lotes_comprados,
                c.modalidades ?? '',
                c.primera_compra ? dateLabel(c.primera_compra) : '',
                c.ultima_compra ? dateLabel(c.ultima_compra) : '',
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
              ? 'Cuando se confirme la primera reserva, el comprador aparece en esta lista.'
              : 'Probá con otro filtro o limpiá la búsqueda.'
          }
        />
      ) : (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {visibles.map((c) => {
            const mapa = consultaDeMapa(c);
            return (
              <li key={c.ci_norm} className="px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={() => setFicha(c)}
                    className="font-semibold text-stone-900 hover:text-brand hover:underline"
                    title="Ver la ficha completa"
                  >
                    {c.buyer_full_name}
                  </button>
                  <span className="font-mono text-xs text-stone-400">CI {c.buyer_ci}</span>
                  {(c.modalidades ?? '').split(' · ').filter(Boolean).map((m) => (
                    <span
                      key={m}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        BADGE_MODALIDAD[m] ?? 'bg-stone-100 text-stone-600'
                      }`}
                    >
                      {m}
                    </span>
                  ))}
                  {c.lotes_comprados > 0 ? (
                    <span className="text-xs text-stone-500">
                      {c.lotes_comprados} lote{c.lotes_comprados === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="text-xs text-stone-400">sin comprar</span>
                  )}
                  <span className="ml-auto text-xs text-stone-500">
                    {c.primera_compra
                      ? c.ultima_compra && c.ultima_compra !== c.primera_compra
                        ? `${dateLabel(c.primera_compra)} — ${dateLabel(c.ultima_compra)}`
                        : dateLabel(c.primera_compra)
                      : `desde ${dateLabel(c.primera_actividad)}`}
                  </span>
                  {c.buyer_phone ? (
                    <a
                      href={waLink(
                        c.buyer_phone,
                        `Hola ${c.buyer_full_name.split(' ')[0] ?? ''}, le escribimos de Terrenalv.`,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-green-700"
                    >
                      WhatsApp
                    </a>
                  ) : null}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                  {c.direccion ? <span>{c.direccion}</span> : null}
                  {c.referencias ? <span className="text-stone-400">{c.referencias}</span> : null}
                  {!c.direccion ? (
                    <button
                      type="button"
                      onClick={() => setFicha(c)}
                      className="text-stone-400 underline hover:text-stone-600"
                    >
                      cargar dirección
                    </button>
                  ) : null}
                  {mapa ? (
                    <a
                      href={enlaceDeMapa(mapa)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-brand hover:underline"
                    >
                      Mapa ↗
                    </a>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {ficha ? (
        <FichaClienteDialog
          ci={ficha.ci_norm}
          nombre={ficha.buyer_full_name}
          sinPlata
          onClose={() => {
            setFicha(null);
            // Puede haber cargado la dirección desde la ficha.
            void cargar();
          }}
        />
      ) : null}
    </div>
  );
}
