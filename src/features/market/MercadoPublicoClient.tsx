'use client';

// La vidriera del mercado de traspasos, para cualquiera que pase.
//
// Lee v_mercado con la llave anónima (la vista solo expone el lote, jamás al
// vendedor) y deja una consulta vía RPC. El tono es el del resto del sitio
// público: claro con la plata, claro con las reglas.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';

interface Aviso {
  listing_id: string;
  proyecto: string;
  slug: string;
  manzana: string | null;
  lote: string | null;
  area_m2: number | null;
  precio_lote: number;
  saldo_a_asumir: number;
  asking_price_bob: number;
  note: string | null;
  publicada: string;
  fee_pct: number;
  tipo: 'traspaso' | 'venta';
}

export function MercadoPublicoClient() {
  const supabase = useMemo(() => createClient(), []);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [loading, setLoading] = useState(true);
  const [consultar, setConsultar] = useState<Aviso | null>(null);

  useEffect(() => {
    let vivo = true;
    void supabase
      .from('v_mercado')
      .select('*')
      .order('publicada', { ascending: false })
      .then(({ data }) => {
        if (vivo) {
          setAvisos((data ?? []) as Aviso[]);
          setLoading(false);
        }
      });
    return () => {
      vivo = false;
    };
  }, [supabase]);

  return (
    <div className="space-y-5 pt-4">
      <header className="text-center">
        <h1 className="text-2xl font-extrabold text-stone-900">Mercado de traspasos</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-stone-600">
          Lotes de nuestras urbanizaciones que sus compradores ofrecen en traspaso. Si te interesa
          uno, deja tu contacto: la oficina conecta a las partes y el traspaso se firma en
          Terrenalv, con todos los papeles en regla.
        </p>
      </header>

      {loading ? (
        <p className="py-10 text-center text-sm text-stone-500">Cargando avisos…</p>
      ) : avisos.length === 0 ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
          <p className="font-semibold text-stone-800">Hoy no hay lotes ofrecidos.</p>
          <p className="mt-2 text-sm text-stone-600">
            Vuelve pronto, o mira los lotes disponibles directamente de Terrenalv.
          </p>
          <Link
            href="/prados-del-sur/mapa"
            className="mt-4 inline-block rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white active:bg-brand-light"
          >
            Ver el mapa de lotes
          </Link>
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {avisos.map((a) => (
            <article
              key={a.listing_id}
              className="flex flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold tracking-wide text-brand uppercase">
                  {a.proyecto}
                </p>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                    a.tipo === 'traspaso'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-green-100 text-green-800'
                  }`}
                >
                  {a.tipo === 'traspaso' ? 'Traspaso — en pagos' : 'Venta — lote pagado'}
                </span>
              </div>
              <h2 className="mt-1 text-lg font-extrabold text-stone-900">
                Manzana {a.manzana ?? '—'} · Lote {a.lote ?? '—'}
              </h2>
              {a.area_m2 !== null ? (
                <p className="text-sm text-stone-500">{Number(a.area_m2).toFixed(0)} m²</p>
              ) : null}

              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-stone-500">Le pagas al vendedor</dt>
                  <dd className="font-semibold tabular-nums text-stone-900">
                    {formatMoney(Number(a.asking_price_bob), 'BOB')}
                  </dd>
                </div>
                {a.tipo === 'traspaso' ? (
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Saldo que asumes con Terrenalv</dt>
                    <dd className="font-semibold tabular-nums text-stone-700">
                      {formatMoney(Number(a.saldo_a_asumir), 'BOB')}
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-stone-100 pt-1.5">
                  <dt className="font-semibold text-stone-700">Costo total para ti</dt>
                  <dd className="font-bold tabular-nums text-brand">
                    {formatMoney(Number(a.asking_price_bob) + Number(a.saldo_a_asumir), 'BOB')}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">Precio original del lote</dt>
                  <dd className="tabular-nums text-stone-500">
                    {formatMoney(Number(a.precio_lote), 'BOB')}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-stone-500">
                {a.tipo === 'traspaso'
                  ? 'La compra está en curso: recibes lo ya pagado a tu favor y sigues pagando el saldo a Terrenalv.'
                  : 'El lote está pagado por completo: el traspaso te deja como nuevo titular, sin deuda.'}
              </p>

              {a.note ? <p className="mt-3 text-sm text-stone-600">«{a.note}»</p> : null}

              <button
                type="button"
                onClick={() => setConsultar(a)}
                className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white active:bg-brand-light"
              >
                Me interesa este lote
              </button>
              <p className="mt-2 text-center text-[11px] text-stone-400">
                Publicado el {a.publicada}
              </p>
            </article>
          ))}
        </div>
      )}

      <section className="rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600">
        <h3 className="font-bold text-stone-800">Cómo funciona</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Dejas tu nombre y celular en el lote que te interesa.</li>
          <li>El vendedor y la oficina se contactan contigo y acuerdan el precio.</li>
          <li>
            El traspaso se firma en la oficina de Terrenalv, con contrato nuevo a tu nombre.
          </li>
        </ol>
        <p className="mt-3 text-xs text-stone-600">
          <strong>Traspaso — en pagos:</strong> la compra está en curso; le pagas al vendedor lo
          suyo, lo ya pagado queda a tu favor y asumes el saldo con Terrenalv.{' '}
          <strong>Venta — lote pagado:</strong> el lote está cancelado por completo; le compras al
          dueño y no asumes ninguna deuda.
        </p>
        <p className="mt-3 text-xs text-stone-500">
          La venta por el mercado paga a Terrenalv una comisión sobre el precio de venta (la cubre
          el vendedor). Un traspaso directo — sin publicar acá — no paga comisión. Terrenalv es
          dueña de cada lote hasta que se termina de pagar: por eso todo traspaso pasa por la
          oficina.
        </p>
      </section>

      {/* El otro lado del mercado. La vidriera explicaba cómo COMPRAR y no
          decía en ninguna parte cómo publicar: el único punto de entrada
          está dentro de /reserva/[code], que sólo encuentra quien ya sabe
          que existe. */}
      <section className="mt-4 rounded-2xl border border-brand/30 bg-green-50/50 p-5 text-sm">
        <h3 className="font-bold text-stone-800">¿Querés vender tu lote?</h3>
        <p className="mt-1 text-stone-600">
          Entrá a tu cuenta y publicalo desde tus lotes. Si todavía no tenés cuenta, se crea en un
          minuto: es lo que nos deja avisarte cuando alguien pregunte por tu lote.
        </p>
        <Link
          href="/cuenta"
          className="mt-3 inline-block rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90"
        >
          Entrar a mi cuenta
        </Link>
      </section>

      {consultar ? (
        <ConsultaDialog aviso={consultar} onClose={() => setConsultar(null)} />
      ) : null}
    </div>
  );
}

/* ========================================================================== */

function ConsultaDialog({ aviso, onClose }: { aviso: Aviso; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function enviar() {
    setError(null);
    if (nombre.trim().length < 3) {
      setError('Escribe tu nombre completo.');
      return;
    }
    if (telefono.trim().length < 7) {
      setError('Escribe tu número de celular.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('mercado_consultar', {
      p_listing_id: aviso.listing_id,
      p_nombre: nombre.trim(),
      p_telefono: telefono.trim(),
      p_mensaje: mensaje.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(
        err.message.includes('PHONE')
          ? 'Revisa el celular: debe ser un número boliviano válido.'
          : err.message.includes('LISTING_NOT_FOUND')
            ? // El vendedor lo retiró mientras esta página estaba abierta.
              // Reintentar no lo va a resolver: hay que recargar.
              'Este lote ya no está publicado. Actualizá la página para ver los que siguen disponibles.'
            : err.message.includes('NAME_REQUIRED')
              ? 'Escribí tu nombre para que el vendedor sepa quién pregunta.'
              : err.message.includes('DEMASIADAS')
                ? 'Este aviso recibió muchas consultas hoy. Probá mañana o escribinos por WhatsApp.'
                : 'No se pudo enviar la consulta. Intenta de nuevo en un momento.',
      );
      return;
    }
    setListo(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {listo ? (
          <div className="text-center">
            <h2 className="text-lg font-extrabold text-brand">¡Consulta enviada!</h2>
            <p className="mt-2 text-sm text-stone-600">
              El vendedor y la oficina de Terrenalv verán tu contacto y te llamarán para coordinar.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white"
            >
              Listo
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-extrabold text-stone-900">
              Mz {aviso.manzana ?? '—'} · Lote {aviso.lote ?? '—'} — {aviso.proyecto}
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Deja tu contacto y te llaman para coordinar. Sin compromiso.
            </p>
            <div className="mt-4 space-y-3">
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Tu nombre completo"
                className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm"
              />
              <input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="Tu celular (ej. 70012345)"
                inputMode="tel"
                className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm"
              />
              <textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                rows={2}
                placeholder="Mensaje (opcional)"
                className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm"
              />
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void enviar()}
                className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white active:bg-brand-light disabled:opacity-60"
              >
                {busy ? 'Enviando…' : 'Enviar mi consulta'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm font-bold text-stone-600"
              >
                Volver
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
