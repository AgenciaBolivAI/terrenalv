'use client';

// «Ofrecer mi lote en el mercado» — la punta del vendedor, en su página de
// seguimiento. Su código de seguimiento es la llave: con él publica, cambia el
// precio, retira el aviso y ve quién preguntó. Nada de cuentas nuevas.
//
// Las reglas van dichas ANTES de publicar: publicar es gratis; si el lote se
// vende por el mercado, Terrenalv cobra una comisión sobre el precio de venta;
// el traspaso siempre se firma en oficina.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';

interface Publicacion {
  listing_id: string;
  pide: number;
  nota: string | null;
  estado: 'activa' | 'pausada';
  comision_pct: number;
  consultas: number;
}

interface Consulta {
  nombre: string;
  telefono: string;
  mensaje: string | null;
  fecha: string;
}

export function MiPublicacion({ code }: { code: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [pub, setPub] = useState<Publicacion | null>(null);
  const [cargado, setCargado] = useState(false);
  const [consultas, setConsultas] = useState<Consulta[] | null>(null);
  const [editando, setEditando] = useState(false);
  const [pide, setPide] = useState('');
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('mercado_mi_publicacion', {
      p_tracking_code: code,
    });
    setPub((data as Publicacion | null) ?? null);
    setCargado(true);
  }, [supabase, code]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function verConsultas() {
    const { data } = await supabase.rpc('mercado_mis_consultas', {
      p_tracking_code: code,
    });
    setConsultas((data as Consulta[] | null) ?? []);
  }

  async function publicar() {
    setError(null);
    if (!(Number(pide) > 0)) {
      setError('Escribe cuánto pides por tu lote, en bolivianos.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('mercado_publicar', {
      p_tracking_code: code,
      p_asking: Number(pide),
      p_note: nota.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError('No se pudo publicar. Intenta de nuevo en un momento.');
      return;
    }
    setEditando(false);
    void cargar();
  }

  async function retirar() {
    setBusy(true);
    const { error: err } = await supabase.rpc('mercado_retirar', {
      p_tracking_code: code,
    });
    setBusy(false);
    if (!err) {
      setConsultas(null);
      void cargar();
    }
  }

  if (!cargado) return null;

  // ---- Sin publicación: la oferta de publicar --------------------------------
  if (!pub || editando) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h3 className="font-extrabold text-stone-900">
          {pub ? 'Cambiar mi aviso' : '¿Quieres traspasar tu lote?'}
        </h3>
        <p className="mt-1 text-sm text-stone-600">
          Publícalo en el <strong>mercado de traspasos</strong> de Terrenalv. Los interesados dejan
          su contacto y tú decides con quién cerrar. Publicar es gratis.
        </p>
        {editando || pub === null ? (
          <div className="mt-4 space-y-3">
            <input
              type="number"
              min={0}
              value={pide}
              onChange={(e) => setPide(e.target.value)}
              placeholder="¿Cuánto pides? (Bs)"
              inputMode="decimal"
              className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm"
            />
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              placeholder="Nota para los interesados (opcional)"
              className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm"
            />
            <p className="text-xs text-stone-500">
              Si tu lote se vende por el mercado, Terrenalv cobra una comisión sobre el precio de
              venta al firmar el traspaso
              {pub ? ` (${Number(pub.comision_pct)}% en tu aviso)` : ''}. El traspaso siempre se
              firma en oficina: el comprador nuevo asume tu saldo y lo que ya pagaste queda a su
              favor.
            </p>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void publicar()}
              className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white active:bg-brand-light disabled:opacity-60"
            >
              {busy ? 'Publicando…' : pub ? 'Guardar cambios' : 'Publicar en el mercado'}
            </button>
            {editando ? (
              <button
                type="button"
                onClick={() => setEditando(false)}
                className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm font-bold text-stone-600"
              >
                Volver
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  // ---- Con publicación: estado, consultas y controles ------------------------
  return (
    <section className="rounded-2xl border border-brand/30 bg-green-50/50 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-stone-900">Tu lote está en el mercado</h3>
          <p className="mt-1 text-sm text-stone-600">
            Pides <strong>{formatMoney(Number(pub.pide), 'BOB')}</strong>
            {pub.estado === 'pausada' ? ' · aviso pausado por la oficina' : ''}
          </p>
          {pub.nota ? <p className="mt-1 text-xs text-stone-500">«{pub.nota}»</p> : null}
        </div>
        <span className="rounded-full bg-brand px-3 py-1 text-xs font-bold text-white">
          {pub.consultas} consulta{Number(pub.consultas) === 1 ? '' : 's'}
        </span>
      </div>

      {consultas === null ? (
        Number(pub.consultas) > 0 ? (
          <button
            type="button"
            onClick={() => void verConsultas()}
            className="mt-3 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white active:bg-brand-light"
          >
            Ver quién preguntó
          </button>
        ) : (
          <p className="mt-3 text-sm text-stone-500">
            Nadie preguntó todavía. Los interesados que dejen su contacto aparecerán acá.
          </p>
        )
      ) : (
        <ul className="mt-3 space-y-2">
          {consultas.length === 0 ? (
            <li className="text-sm text-stone-500">Nadie preguntó todavía.</li>
          ) : (
            consultas.map((c, i) => (
              <li key={i} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-stone-900">{c.nombre}</p>
                  <a
                    href={`https://wa.me/591${c.telefono.replace(/\D/g, '').slice(-8)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-bold text-brand underline"
                  >
                    WhatsApp
                  </a>
                </div>
                <p className="text-xs text-stone-500">
                  {c.telefono} · {c.fecha}
                </p>
                {c.mensaje ? <p className="mt-1 text-sm text-stone-700">{c.mensaje}</p> : null}
              </li>
            ))
          )}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            setPide(String(pub.pide));
            setNota(pub.nota ?? '');
            setEditando(true);
          }}
          className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-700"
        >
          Cambiar precio
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void retirar()}
          className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-700 disabled:opacity-60"
        >
          Retirar del mercado
        </button>
      </div>
      <p className="mt-3 text-xs text-stone-500">
        Si se vende por el mercado, la comisión de Terrenalv es el{' '}
        {Number(pub.comision_pct)}% del precio de venta y se cobra al firmar el traspaso en
        oficina.
      </p>
    </section>
  );
}
