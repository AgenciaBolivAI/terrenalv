'use client';

// La casa del comprador: sus lotes, sus datos, y la puerta al mercado.
//
// Sustituye al código de seguimiento suelto. El código sigue existiendo —es lo
// que prueba que una compra es suya— pero se usa UNA vez, para reclamarla; de
// ahí en adelante la compra vive en su cuenta y no hay nada que perder.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { btnPrimary, btnSecondary, inputClass, Spinner } from '@/features/admin/ui/bits';

interface Ficha {
  id: string;
  email_verificado_at: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  ci: string | null;
  birth_date: string | null;
  city: string | null;
  marketing_opt_in: boolean;
}

interface Compra {
  reservation_id: string;
  tracking_code: string;
  proyecto: string;
  manzana: string | null;
  lote: string | null;
  price_agreed: number;
  pagado_total: number | null;
  saldo: number | null;
  estado: string;
}

export default function PanelCliente() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [codigo, setCodigo] = useState('');
  const [ciReclamo, setCiReclamo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifEstado, setVerifEstado] = useState<'idle' | 'enviando' | 'enviado' | 'error'>('idle');
  const [verifMsg, setVerifMsg] = useState<string | null>(null);

  // El alta no pasa por el correo, así que un error de tipeo deja una cuenta
  // viva sobre una dirección que no existe — y de esa dirección dependen el
  // aviso de cuota y el saludo de cumpleaños. Se pide confirmar, pero NUNCA
  // se bloquea nada: es un aviso que se puede ignorar para siempre.
  async function pedirVerificacion() {
    setVerifEstado('enviando');
    setVerifMsg(null);
    const res = await fetch('/api/cuenta/verificar', { method: 'POST' });
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setVerifEstado('error');
      setVerifMsg(j?.error ?? 'No pudimos enviarlo. Probá en un rato.');
      return;
    }
    setVerifEstado('enviado');
  }

  const cargar = useCallback(async () => {
    const { data: sesion } = await supabase.auth.getUser();
    if (!sesion.user) {
      router.push('/cuenta');
      return;
    }
    const [f, c] = await Promise.all([
      supabase.from('customers').select('*').eq('id', sesion.user.id).maybeSingle(),
      // RLS ya recorta a lo suyo: no hace falta filtrar por cliente acá.
      supabase
        .from('v_cliente_actividad')
        .select('reservation_id, tracking_code, proyecto, manzana, lote, price_agreed, pagado_total, saldo, estado'),
    ]);
    setFicha((f.data as Ficha | null) ?? null);
    setCompras((c.data ?? []) as unknown as Compra[]);
    setCargando(false);
  }, [supabase, router]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function reclamar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setBusy(true);
    const { data, error: err } = await supabase.rpc('reclamar_mi_compra', {
      p_tracking_code: codigo.trim().toUpperCase(),
      p_ci: ciReclamo.trim(),
    });
    setBusy(false);
    if (err) {
      setError('No pudimos vincular la compra. Intentá de nuevo.');
      return;
    }
    // Los fallos que se cuentan vuelven como resultado, no como excepción: si
    // levantaran excepción, la anotación del intento se revertiría con ella y
    // el freno de intentos no existiría.
    const r = data as { ok: boolean; error?: string } | null;
    if (!r?.ok) {
      setError(
        r?.error === 'YA_RECLAMADA'
          ? 'Esa compra ya está en otra cuenta. Si es un error, escribinos.'
          : r?.error === 'DEMASIADOS_INTENTOS'
            ? 'Demasiados intentos. Esperá una hora o escribinos y la vinculamos nosotros.'
            : 'El código y el carnet no coinciden con ningún contrato. Revisá los dos.',
      );
      return;
    }
    setCodigo('');
    setCiReclamo('');
    setAviso('Listo: tu compra quedó en tu cuenta.');
    void cargar();
  }

  async function salir() {
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  if (cargando) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-900">Hola, {ficha?.full_name ?? ''}</h1>
          <p className="text-xs text-stone-500">{ficha?.email}</p>
        </div>
        <button type="button" onClick={salir} className={btnSecondary}>
          Salir
        </button>
      </header>

      {ficha && !ficha.email_verificado_at ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            <strong>Confirmá tu correo.</strong> Nos sirve para avisarte cuando vence tu cuota,
            mandarte tus recibos y saludarte en tu cumpleaños. Podés seguir usando tu cuenta
            igual — esto no te frena nada.
          </p>
          {verifEstado === 'enviado' ? (
            <p className="mt-2 text-sm font-semibold text-green-800">
              Te mandamos el enlace a {ficha.email}. Revisá también el correo no deseado.
            </p>
          ) : (
            <button
              type="button"
              onClick={pedirVerificacion}
              disabled={verifEstado === 'enviando'}
              className="mt-2 rounded-full bg-amber-800 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 disabled:opacity-60"
            >
              {verifEstado === 'enviando' ? 'Enviando…' : 'Mandame el enlace'}
            </button>
          )}
          {verifMsg ? <p className="mt-2 text-xs text-amber-900">{verifMsg}</p> : null}
        </section>
      ) : null}

      <section>
        <h2 className="text-xs font-bold tracking-wide text-stone-500 uppercase">
          Mis lotes — {compras.length}
        </h2>
        {compras.length === 0 ? (
          <p className="mt-2 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
            Todavía no tenés ninguna compra en tu cuenta. Si ya compraste, vinculála abajo con el
            código de seguimiento que te dio la oficina.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {compras.map((c) => (
              <li key={c.reservation_id} className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-stone-900">
                    Mz {c.manzana ?? '—'}, Lote {c.lote ?? '—'}
                  </p>
                  <span className="font-mono text-xs text-stone-500">{c.tracking_code}</span>
                </div>
                <p className="text-xs text-stone-500">{c.proyecto}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
                  <div>
                    <dt className="text-[11px] text-stone-500">Precio</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatMoney(Number(c.price_agreed), 'BOB')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-stone-500">Pagado</dt>
                    <dd className="font-semibold tabular-nums text-brand">
                      {formatMoney(Number(c.pagado_total ?? 0), 'BOB')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-stone-500">Saldo</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatMoney(Number(c.saldo ?? 0), 'BOB')}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/reserva/${c.tracking_code}`} className={btnSecondary}>
                    Ver mi compra
                  </Link>
                  <Link href={`/reserva/${c.tracking_code}/plan`} className={btnSecondary}>
                    Mi plan de pagos
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <h2 className="text-xs font-bold tracking-wide text-stone-500 uppercase">
          Vincular una compra
        </h2>
        <p className="mt-1 text-xs text-stone-600">
          Pegá el código de seguimiento y el carnet que figura en el contrato. Pedimos los dos para
          que nadie más pueda quedarse con tu compra. Se hace una sola vez.
        </p>
        <form onSubmit={reclamar} className="mt-2 flex flex-wrap gap-2">
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="EDS-XXXX-XXXX"
            className={`${inputClass} w-auto flex-1 font-mono uppercase`}
          />
          <input
            value={ciReclamo}
            onChange={(e) => setCiReclamo(e.target.value)}
            placeholder="Carnet del contrato"
            className={`${inputClass} w-auto flex-1`}
          />
          <button
            type="submit"
            disabled={busy || !codigo.trim() || !ciReclamo.trim()}
            className={btnPrimary}
          >
            Vincular
          </button>
        </form>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        {aviso ? <p className="mt-2 text-sm text-green-700">{aviso}</p> : null}
      </section>

      <p className="text-center text-xs text-stone-500">
        ¿Querés vender uno de tus lotes?{' '}
        <Link href="/mercado" className="font-semibold text-brand underline">
          Mirá el mercado de traspasos
        </Link>
      </p>
    </div>
  );
}
