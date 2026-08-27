'use client';

// El plan de pago como ARCHIVO PDF, para mandárselo al comprador.
//
// Un enlace se pierde entre los mensajes; el PDF queda en su teléfono y lo
// puede reenviar a su esposa, a su contador o al banco. Se arma con el mismo
// motor que el resto de las exportaciones del panel, así que sale con el
// membrete y el formato de la casa.
//
// LÍMITE HONESTO: un enlace de WhatsApp (wa.me) solo lleva TEXTO — no puede
// adjuntar archivos. Por eso el botón de enviar primero baja el PDF y después
// abre WhatsApp con el mensaje escrito: el archivo ya está en Descargas
// esperando el clip. Adjuntarlo solo, sin tocar nada, necesita la API de
// WhatsApp Business (token y phone id).

import { useState } from 'react';
import { exportPdf, num as fnum, type Cell } from '@/features/admin/export';
import { saldosCorridos, terminosDelPlan } from './cuentas';
import type { EstadoDeCuenta } from './estado-de-cuenta';
import { formatMoney, waLink } from '@/lib/format';
import { IconWhatsapp } from '@/features/admin/ui/icons';

export type PlanPdfDatos = EstadoDeCuenta;

function fecha(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/La_Paz',
  });
}

/** Arma el PDF del cronograma y lo baja. Devuelve el nombre del archivo. */
export async function bajarPlanPdf(p: PlanPdfDatos): Promise<string> {
  const cuotas = p.plan?.cuotas ?? [];
  const totalCuotas = cuotas.reduce((s, c) => s + Number(c.amount), 0);
  const totalInteres = cuotas.reduce((s, c) => s + Number(c.interes), 0);

  // El saldo corriente: lo que le queda DESPUÉS de cada cuota. La cuenta
  // vive en cuentas.ts, la misma que usa la pantalla, con sus tests.
  const saldos = saldosCorridos(cuotas);

  // «Pagado» en el PDF es la PLATA ENTREGADA (los mismos recibos), no solo el
  // capital: misma regla que la pantalla del estado de cuenta.
  const entregado =
    Math.round(
      p.pagos
        .filter((x) => x.estado === 'aprobado')
        .reduce((s, x) => s + Number(x.amount_bob), 0) * 100,
    ) / 100;
  const interesPagado = Math.max(0, Math.round((entregado - Number(p.pagado)) * 100) / 100);
  const filas: Cell[][] = cuotas.map((c, i) => {
    return [
      c.number,
      fecha(c.due_date),
      fnum(Number(c.amount)),
      fnum(saldos[i]),
      c.status === 'pagada'
        ? 'Pagada'
        : Number(c.amount_paid) > 0
          ? `Parcial ${fnum(Number(c.amount_paid))}`
          : 'Pendiente',
    ];
  });

  const condiciones =
    `Lote: Mz ${p.manzana ?? '—'}, Lote ${p.lote ?? '—'} — ${p.proyecto}   ·   ` +
    `Precio ${formatMoney(Number(p.precio), 'BOB')}   ·   ` +
    `Entregado ${formatMoney(entregado, 'BOB')}` +
    (interesPagado > 0.01
      ? ` (${formatMoney(Number(p.pagado), 'BOB')} al precio + ${formatMoney(interesPagado, 'BOB')} de interés)`
      : '') +
    `   ·   ` +
    // La resta, escrita entera: precio menos lo que fue al precio da el saldo.
    `Saldo del lote ${formatMoney(Number(p.precio), 'BOB')} − ${formatMoney(Number(p.pagado), 'BOB')}` +
    ` = ${formatMoney(Number(p.saldo), 'BOB')}` +
    (p.plan
      ? `   ·   ${terminosDelPlan(p.plan, (n) => formatMoney(n, 'BOB'))}`
      : '') +
    (Number(p.plan?.monthly_interest_pct ?? 0) > 0
      ? `   ·   Interés ${Number(p.plan?.monthly_interest_pct)}% mensual sobre saldo   ·   ` +
        `Interés total ${formatMoney(totalInteres, 'BOB')}   ·   ` +
        `Total a pagar ${formatMoney(totalCuotas, 'BOB')}`
      : '');

  const filename = `plan-de-pago-${p.tracking_code}`;

  await exportPdf(
    {
      title: `Plan de pago — ${p.buyer_full_name}`,
      subtitle:
        `${p.tracking_code} · CI ${p.buyer_ci}` +
        (p.plan ? ` · Primera cuota ${fecha(p.plan.first_due_date)}` : ''),
      filename,
      footnote:
        condiciones +
        '   |   No constituye factura. Terrenalv S.R.L. conserva la propiedad del lote hasta la cancelación total del precio.',
    },
    [
      { header: 'N°', align: 'right', width: 28 },
      { header: 'Vence' },
      { header: 'Cuota', align: 'right' },
      // «Saldo del plan», no «Le queda»: lo que falta del PLAN (con el
      // interés que viene) no es lo que falta del LOTE, y llamarlos igual en
      // el mismo papel es lo que impedía cuadrarlo.
      { header: 'Saldo del plan', align: 'right' },
      { header: 'Estado' },
    ],
    filas,
    { orientation: 'portrait' },
  );

  return `${filename}.pdf`;
}

export function PlanPdfButton({ d: p }: { d: PlanPdfDatos }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
      onClick={async () => {
        setBusy(true);
        await bajarPlanPdf(p);
        setBusy(false);
      }}
    >
      {busy ? 'Armando…' : 'Descargar PDF'}
    </button>
  );
}

/**
 * Enviar el plan por WhatsApp: baja el PDF y abre el chat con el mensaje
 * escrito, para adjuntar el archivo que quedó en Descargas.
 */
export function EnviarPlanPdfWhatsapp({ d: p }: { d: PlanPdfDatos }) {
  const [busy, setBusy] = useState(false);

  if (!p.buyer_phone) {
    return (
      <span
        className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-400"
        title="Este comprador no tiene celular cargado."
      >
        Sin celular
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
      title="Baja el PDF y abre WhatsApp para adjuntarlo"
      onClick={async () => {
        setBusy(true);
        const archivo = await bajarPlanPdf(p);
        const enlace =
          typeof window === 'undefined'
            ? ''
            : `${window.location.origin}/reserva/${encodeURIComponent(p.tracking_code)}/plan`;
        const texto =
          `Hola ${p.buyer_full_name.split(' ')[0] ?? ''}, te paso tu plan de pago de Terrenalv: ` +
          (p.plan
            ? `${terminosDelPlan(p.plan, (n) => formatMoney(n, 'BOB'))}. `
            : `saldo ${formatMoney(Number(p.saldo), 'BOB')}. `) +
          `Te adjunto el cronograma en PDF. También podés verlo online acá: ${enlace}`;
        window.open(waLink(p.buyer_phone as string, texto), '_blank', 'noopener,noreferrer');
        setBusy(false);
        window.alert(
          `El PDF «${archivo}» quedó en Descargas.\n\n` +
            'En WhatsApp tocá el clip 📎 y adjuntalo.\n\n' +
            'Para que se adjunte solo hace falta la API de WhatsApp Business (token y phone id).',
        );
      }}
    >
      <IconWhatsapp className="h-4 w-4" />
      {busy ? 'Armando PDF…' : 'Enviar PDF por WhatsApp'}
    </button>
  );
}
