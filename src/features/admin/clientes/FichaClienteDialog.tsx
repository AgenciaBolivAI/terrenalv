'use client';

// La ficha del cliente, en cualquier pantalla donde aparezca su nombre.
//
// La regla de la casa dice que ningún número es un callejón sin salida; el
// nombre de una persona tampoco. Desde Ventas, Planes o el Mercado, un clic
// abre quién es, cuántos lotes tiene, cuánto pagó, cuánto debe, si está en
// mora y qué hizo en el mercado — sin perder la pantalla donde se estaba.
//
// Lee las mismas vistas que el módulo de Clientes, así que no puede decir algo
// distinto: es la misma verdad, en una ventana más chica.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, waLink } from '@/lib/format';
import { Badge, Spinner, btnPrimary, btnSecondary } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { dateLabel } from '@/features/admin/contabilidad/types';

interface ClienteResumen {
  ci_norm: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string;
  buyer_email: string | null;
  reservas_totales: number;
  lotes_comprados: number;
  lotes_reservados: number;
  reservas_expiradas: number;
  reservas_canceladas: number;
  traspasos_cedidos: number;
  traspasos_recibidos: number;
  proyectos: number;
  pagado_total: number;
  saldo_total: number;
  con_plan: number;
  cuotas_vencidas: number;
  monto_vencido: number;
  primera_actividad: string;
  ultima_actividad: string | null;
  comisiones_pagadas: number;
  avisos_mercado: number;
  avisos_activos: number;
  vendidos_mercado: number;
  vendido_mercado_bob: number;
  nombres_distintos: number;
  nombres_vistos: string;
}

interface ActividadResumen {
  reservation_id: string;
  tracking_code: string;
  estado: string;
  proyecto: string;
  manzana: string | null;
  lote: string | null;
  saldo: number | null;
  pagado_total: number | null;
  con_plan: boolean | null;
  origen_label: string;
  fecha_confirmada: string | null;
  created_at: string;
  recibida_por_traspaso: boolean;
  cedida_por_traspaso: boolean;
  comprada_en_mercado: boolean;
  vendida_en_mercado: boolean;
}

const ESTADO_BADGE: Record<string, string> = {
  confirmada: 'bg-green-100 text-green-700',
  pendiente_pago: 'bg-amber-100 text-amber-800',
  en_verificacion: 'bg-amber-100 text-amber-800',
  rechazo_reintento: 'bg-amber-100 text-amber-800',
  expirada: 'bg-stone-200 text-stone-600',
  cancelada: 'bg-stone-200 text-stone-600',
};

const ESTADO_LABEL: Record<string, string> = {
  confirmada: 'Comprado',
  pendiente_pago: 'Reservado',
  en_verificacion: 'En verificación',
  rechazo_reintento: 'Reintento',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
};

/**
 * @param ci El carnet tal como lo tiene la pantalla que llama — crudo o
 *   normalizado. Acá se resuelven los dos, porque quien enlaza no tiene por
 *   qué saber cómo normaliza la base.
 */
export function FichaClienteDialog({
  ci,
  nombre,
  onClose,
}: {
  ci: string;
  nombre?: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [actividad, setActividad] = useState<ActividadResumen[]>([]);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const limpio = ci.replace(/,/g, '');
      const { data } = await supabase
        .from('v_clientes')
        .select('*')
        .or(`ci_norm.eq.${limpio},buyer_ci.eq.${limpio}`)
        .limit(1)
        .maybeSingle();
      if (!vivo) return;
      const c = (data as ClienteResumen | null) ?? null;
      setCliente(c);
      if (c) {
        const { data: act } = await supabase
          .from('v_cliente_actividad')
          .select(
            'reservation_id, tracking_code, estado, proyecto, manzana, lote, saldo, pagado_total, ' +
              'con_plan, origen_label, fecha_confirmada, created_at, recibida_por_traspaso, ' +
              'cedida_por_traspaso, comprada_en_mercado, vendida_en_mercado',
          )
          .eq('ci_norm', c.ci_norm)
          .order('created_at', { ascending: false });
        if (!vivo) return;
        setActividad((act ?? []) as unknown as ActividadResumen[]);
      }
      setCargado(true);
    })();
    return () => {
      vivo = false;
    };
  }, [supabase, ci]);

  return (
    <Dialog open onClose={onClose} wide title={cliente?.buyer_full_name ?? nombre ?? 'Cliente'}>
      {!cargado ? (
        <div className="py-10">
          <Spinner label="Cargando el perfil…" />
        </div>
      ) : !cliente ? (
        <p className="py-6 text-sm text-stone-500">
          No encontramos el perfil de este comprador (CI {ci}). Puede que su carnet esté escrito
          distinto en cada venta: corregilo desde Clientes y los perfiles se unen.
        </p>
      ) : (
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {/* Quién es */}
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-stone-600">
              CI {cliente.buyer_ci} · {cliente.buyer_phone}
              {cliente.buyer_email ? ` · ${cliente.buyer_email}` : ''}
            </p>
            {Number(cliente.proyectos) > 1 ? (
              <Badge className="bg-stone-100 text-stone-600">
                {cliente.proyectos} urbanizaciones
              </Badge>
            ) : null}
            {Number(cliente.cuotas_vencidas) > 0 ? (
              <Badge className="bg-red-100 text-red-700">
                {cliente.cuotas_vencidas} cuota(s) vencida(s) ·{' '}
                {formatMoney(Number(cliente.monto_vencido), 'BOB')}
              </Badge>
            ) : null}
            {Number(cliente.avisos_activos) > 0 ? (
              <Badge className="bg-green-100 text-green-800">
                {cliente.avisos_activos} aviso(s) en el mercado
              </Badge>
            ) : null}
          </div>

          {Number(cliente.nombres_distintos) > 1 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Este carnet aparece con <strong>nombres distintos</strong> ({cliente.nombres_vistos}).
              Un perfil es una persona: si son dos, alguien tecleó el mismo CI en las dos ventas —
              corregí el carnet en la venta equivocada y los perfiles se separan solos.
            </p>
          ) : null}

          {/* La plata, de un vistazo */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-stone-200 bg-white p-3 text-center sm:grid-cols-4">
            <div>
              <p className="text-xs text-stone-500">Lotes comprados</p>
              <p className="text-lg font-bold tabular-nums">{cliente.lotes_comprados}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Reservas en curso</p>
              <p className="text-lg font-bold tabular-nums">{cliente.lotes_reservados}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Nos ha pagado</p>
              <p className="text-lg font-bold tabular-nums text-brand">
                {formatMoney(Number(cliente.pagado_total), 'BOB')}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Nos debe</p>
              <p
                className={`text-lg font-bold tabular-nums ${
                  Number(cliente.saldo_total) > 0 ? 'text-red-600' : 'text-stone-900'
                }`}
              >
                {formatMoney(Number(cliente.saldo_total), 'BOB')}
              </p>
            </div>
          </div>

          {(Number(cliente.traspasos_cedidos) > 0 ||
            Number(cliente.traspasos_recibidos) > 0 ||
            Number(cliente.vendidos_mercado) > 0) && (
            <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
              {Number(cliente.traspasos_recibidos) > 0
                ? `Recibió ${cliente.traspasos_recibidos} lote(s) por traspaso. `
                : ''}
              {Number(cliente.traspasos_cedidos) > 0
                ? `Cedió ${cliente.traspasos_cedidos} lote(s). `
                : ''}
              {Number(cliente.vendidos_mercado) > 0
                ? `Vendió ${cliente.vendidos_mercado} por el mercado por ${formatMoney(
                    Number(cliente.vendido_mercado_bob),
                    'BOB',
                  )} y pagó ${formatMoney(Number(cliente.comisiones_pagadas), 'BOB')} de comisión.`
                : ''}
            </p>
          )}

          {/* Sus lotes */}
          <div>
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Sus lotes y reservas
            </p>
            <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
              {actividad.map((a) => (
                <li key={a.reservation_id} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={ESTADO_BADGE[a.estado] ?? 'bg-stone-100 text-stone-600'}>
                      {ESTADO_LABEL[a.estado] ?? a.estado}
                    </Badge>
                    <span className="text-stone-800">
                      Mz {a.manzana ?? '—'}, Lote {a.lote ?? '—'}
                    </span>
                    <span className="text-xs text-stone-400">{a.proyecto}</span>
                    <Link
                      href={
                        a.estado === 'confirmada'
                          ? `/admin/ventas?open=${a.reservation_id}`
                          : `/admin/reservas?open=${a.reservation_id}`
                      }
                      className="ml-auto font-mono text-xs font-semibold text-brand hover:underline"
                    >
                      {a.tracking_code}
                    </Link>
                  </div>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {a.origen_label} · {dateLabel(a.fecha_confirmada ?? a.created_at)}
                    {a.estado === 'confirmada' && a.saldo !== null ? (
                      <>
                        {' '}
                        · pagado {formatMoney(Number(a.pagado_total ?? 0), 'BOB')} ·{' '}
                        <span className={Number(a.saldo) > 0 ? 'font-semibold text-red-600' : ''}>
                          saldo {formatMoney(Number(a.saldo), 'BOB')}
                        </span>
                        {a.con_plan ? ' · con plan' : ''}
                      </>
                    ) : null}
                    {a.comprada_en_mercado ? ' · comprada en el mercado' : ''}
                    {a.vendida_en_mercado ? ' · vendida por el mercado' : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-stone-100 pt-3">
        {cliente ? (
          <>
            <a
              href={waLink(
                cliente.buyer_phone,
                `Hola ${cliente.buyer_full_name.split(' ')[0] ?? ''}, le escribimos de Terrenalv.`,
              )}
              target="_blank"
              rel="noopener noreferrer"
              className={btnSecondary}
            >
              WhatsApp
            </a>
            <Link
              href={`/admin/clientes?ci=${encodeURIComponent(cliente.ci_norm)}`}
              className={btnPrimary}
            >
              Abrir perfil completo
            </Link>
          </>
        ) : (
          <button type="button" className={btnPrimary} onClick={onClose}>
            Cerrar
          </button>
        )}
      </div>
    </Dialog>
  );
}
