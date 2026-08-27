'use client';

// «Mi cuenta»: lo que cada miembro del equipo ve de SÍ MISMO.
//
// Un vendedor tiene derecho a ver lo suyo sin pedírselo a nadie —qué vendió,
// cuándo, por cuánto, qué comisión le corresponde y qué le pagaron— y NO a
// ver el sueldo del de al lado. Por eso los datos llegan por una función que
// filtra por la sesión, no por una tabla que se pueda consultar entera.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import {
  Badge,
  EmptyState,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { dateLabel } from '@/features/admin/contabilidad/types';

interface Venta {
  reservation_id: string;
  tracking_code: string;
  fecha: string | null;
  proyecto: string;
  manzana: string | null;
  lote: string | null;
  comprador: string;
  precio: number;
  cobrado: number;
  pct: number;
  base: string;
  ganado: number;
  pagado: number;
  por_pagar: number;
  estado: string;
}

interface Pago {
  fecha: string;
  monto: number;
  venta: string | null;
  nota: string | null;
}

interface Cuenta {
  profile_id: string;
  nombre: string;
  rol: string;
  resumen: {
    ventas: number;
    valor_vendido: number;
    cobrado: number;
    ganado: number;
    pagado: number;
    por_pagar: number;
  };
  reservas_en_curso: number;
  ventas: Venta[];
  pagos_recibidos: Pago[];
}

export default function MiCuentaClient() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  // Cada uno corrige su nombre y su teléfono. El rol y los permisos no: eso
  // lo decide el administrador.
  const [editarPerfil, setEditarPerfil] = useState<{ nombre: string; tel: string } | null>(null);
  const [c, setC] = useState<Cuenta | null>(null);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void supabase.rpc('mi_cuenta').then(({ data }) => {
      if (!vivo) return;
      setC((data as Cuenta | null) ?? null);
      setCargado(true);
    });
    return () => {
      vivo = false;
    };
  }, [supabase]);

  if (!cargado) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (!c) {
    return <EmptyState title="No pudimos cargar tu cuenta" hint="Volvé a entrar al panel." />;
  }

  const r = c.resumen;
  const avance =
    Number(r.ganado) > 0 ? Math.round((Number(r.pagado) / Number(r.ganado)) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-900">Mi cuenta</h1>
          <p className="text-xs text-stone-500">
            {c.nombre} · {c.rol} — tus ventas y tus comisiones.
          </p>
        </div>
        <button
          type="button"
          className={`${btnSecondary} ml-auto`}
          onClick={() => setEditarPerfil({ nombre: c.nombre, tel: '' })}
        >
          Editar mi perfil
        </button>
      </div>

      {editarPerfil ? (
        <Dialog open onClose={() => setEditarPerfil(null)} title="Mi perfil">
          <p className="text-sm text-stone-600">
            Corregí tu nombre y tu teléfono. El rol y los permisos los maneja el administrador.
          </p>
          <label className="mt-3 mb-1 block text-xs text-stone-500">Nombre completo</label>
          <input
            value={editarPerfil.nombre}
            onChange={(e) => setEditarPerfil({ ...editarPerfil, nombre: e.target.value })}
            className={inputClass}
          />
          <label className="mt-3 mb-1 block text-xs text-stone-500">Teléfono</label>
          <input
            value={editarPerfil.tel}
            onChange={(e) => setEditarPerfil({ ...editarPerfil, tel: e.target.value })}
            placeholder="70000000"
            className={inputClass}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setEditarPerfil(null)}>
              Volver
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={async () => {
                const { error } = await supabase.rpc('actualizar_mi_perfil', {
                  p_full_name: editarPerfil.nombre,
                  p_phone: editarPerfil.tel || null,
                });
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                push('Perfil actualizado.', 'success');
                setEditarPerfil(null);
                window.location.reload();
              }}
            >
              Guardar
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* ---- Lo mío, de un vistazo ---- */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Ventas cerradas
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{r.ventas}</p>
          {Number(c.reservas_en_curso) > 0 ? (
            <p className="mt-1 text-xs text-stone-400">
              + {c.reservas_en_curso} reserva(s) en curso
            </p>
          ) : null}
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Vendí
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-stone-800">
            {formatMoney(Number(r.valor_vendido), 'BOB')}
          </p>
          <p className="mt-1 text-xs text-stone-400">
            cobrado {formatMoney(Number(r.cobrado), 'BOB')}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Comisión ganada
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-brand">
            {formatMoney(Number(r.ganado), 'BOB')}
          </p>
          <p className="mt-1 text-xs text-stone-400">
            cobrada {formatMoney(Number(r.pagado), 'BOB')} ({avance}%)
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Me deben
          </p>
          <p
            className={`mt-2 text-2xl font-bold tabular-nums ${
              Number(r.por_pagar) > 0 ? 'text-red-600' : 'text-stone-900'
            }`}
          >
            {formatMoney(Number(r.por_pagar), 'BOB')}
          </p>
        </div>
      </section>

      {/* ---- Mis ventas ---- */}
      <section className="rounded-xl border border-stone-200 bg-white">
        <p className="border-b border-stone-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">
          Mis ventas — {c.ventas.length}
        </p>
        {c.ventas.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title="Todavía no tenés ventas a tu nombre"
              hint="Cuando cierres una venta o tomes una reserva y quede asignada a vos, aparece acá con su comisión."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Fecha</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Lote</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Comprador</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Precio
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Mi comisión
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Me pagaron
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Me deben
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.ventas.map((v) => (
                  <tr key={v.reservation_id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-2.5 text-xs text-stone-500">
                      {v.fecha ? dateLabel(v.fecha) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-stone-900">
                        Mz {v.manzana ?? '—'}, Lote {v.lote ?? '—'}
                      </p>
                      <p className="text-xs text-stone-400">
                        {v.proyecto} ·{' '}
                        <Link
                          href={`/admin/ventas?open=${v.reservation_id}`}
                          className="font-mono text-brand hover:underline"
                        >
                          {v.tracking_code}
                        </Link>
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-stone-700">{v.comprador}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">
                      {formatMoney(Number(v.precio), 'BOB')}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <p className="font-semibold tabular-nums text-brand">
                        {formatMoney(Number(v.ganado), 'BOB')}
                      </p>
                      <p className="text-[11px] text-stone-400">
                        {Number(v.pct)}% sobre{' '}
                        {v.base === 'precio' ? 'el precio' : 'lo cobrado'}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">
                      {formatMoney(Number(v.pagado), 'BOB')}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {Number(v.por_pagar) > 0 ? (
                        <span className="font-semibold tabular-nums text-red-600">
                          {formatMoney(Number(v.por_pagar), 'BOB')}
                        </span>
                      ) : (
                        <Badge className="bg-green-100 text-green-700">al día</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-400">
          Cuando la comisión es <strong>sobre lo cobrado</strong>, se gana a medida que el
          comprador paga: si su plan es a varios años, tu comisión entra al mismo ritmo que su
          plata. Cuando es <strong>sobre el precio</strong>, se gana entera al firmar.
        </p>
      </section>

      {/* ---- Lo que me pagaron ---- */}
      {c.pagos_recibidos.length > 0 ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          <p className="border-b border-stone-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Pagos que recibí
          </p>
          <ul className="divide-y divide-stone-100">
            {c.pagos_recibidos.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 px-4 py-2 text-sm">
                <span className="text-xs text-stone-500">{dateLabel(p.fecha)}</span>
                {p.venta ? (
                  <span className="font-mono text-xs text-stone-400">{p.venta}</span>
                ) : null}
                {p.nota ? <span className="text-xs text-stone-500">{p.nota}</span> : null}
                <span className="ml-auto font-semibold tabular-nums text-stone-900">
                  {formatMoney(Number(p.monto), 'BOB')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
