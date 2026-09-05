'use client';

// Dónde vive el cliente y cómo se llega hasta él.
//
// Esto lo carga LA OFICINA, no el comprador: son los datos que hacen falta
// para ir a buscarlo, no los que él tipeó al reservar. Por eso viven en su
// propia tabla (`client_profiles`) y no en `customers` —que son los que se
// crearon una cuenta en la web, y hoy no hay ninguno— con la misma llave con
// la que Clientes agrupa a una persona en todas sus compras: el carnet
// normalizado.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { useToast } from '@/features/admin/ui/toast';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';

export interface FichaContactoDatos {
  direccion: string | null;
  referencias: string | null;
  ubicacion: string | null;
  nota: string | null;
}

/** Lo que se le pregunta a Google Maps: el punto si lo cargaron, si no la dirección. */
export function consultaDeMapa(f: Partial<FichaContactoDatos>): string {
  return (f.ubicacion ?? '').trim() || (f.direccion ?? '').trim();
}

/** El enlace para abrir o mandar por WhatsApp. Un enlace pegado tal cual ya es el mapa. */
export function enlaceDeMapa(q: string): string {
  return /^https?:\/\//i.test(q)
    ? q
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * El mapa embebido. De un enlace de Google ya armado no se puede sacar el
 * embed, así que ahí no se muestra el recuadro y queda el botón de abrir.
 */
export function embedDeMapa(q: string): string | null {
  if (!q || /^https?:\/\//i.test(q)) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`;
}

/** Copiar, con acuse. Chico, para meterlo al lado del dato. */
function Copiar({ valor, children }: { valor: string; children: React.ReactNode }) {
  const [listo, setListo] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(valor);
          setListo(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setListo(false), 2000);
        } catch {
          // Portapapeles bloqueado: el texto está a la vista para copiarlo a mano.
        }
      }}
      className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
        listo
          ? 'border-green-300 bg-green-50 text-green-700'
          : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
      }`}
    >
      {listo ? '¡Copiado!' : children}
    </button>
  );
}

export function FichaContacto({
  ci,
  soloLectura = false,
}: {
  /** El carnet del cliente; se normaliza en la base. */
  ci: string;
  soloLectura?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [f, setF] = useState<FichaContactoDatos | null>(null);
  const [cargado, setCargado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [borrador, setBorrador] = useState<FichaContactoDatos>({
    direccion: '',
    referencias: '',
    ubicacion: '',
    nota: '',
  });

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('v_ficha_cliente')
      .select('direccion, referencias, ubicacion, nota')
      .eq('ci_normalized', ci.replace(/[.\s-]/g, '').toUpperCase())
      .maybeSingle();
    setF((data as FichaContactoDatos | null) ?? null);
    setCargado(true);
  }, [supabase, ci]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function abrirEdicion() {
    setBorrador({
      direccion: f?.direccion ?? '',
      referencias: f?.referencias ?? '',
      ubicacion: f?.ubicacion ?? '',
      nota: f?.nota ?? '',
    });
    setEditando(true);
  }

  async function guardar() {
    setGuardando(true);
    const { error } = await supabase.rpc('admin_guardar_ficha_cliente', {
      p_ci: ci,
      p_direccion: borrador.direccion,
      p_referencias: borrador.referencias,
      p_ubicacion: borrador.ubicacion,
      p_nota: borrador.nota,
    });
    setGuardando(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('Ficha guardada.', 'success');
    setEditando(false);
    await cargar();
  }

  if (!cargado) return null;

  const q = consultaDeMapa(f ?? {});
  const embed = embedDeMapa(q);
  const vacia = !f?.direccion && !f?.referencias && !f?.ubicacion && !f?.nota;

  if (editando) {
    return (
      <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50/70 p-3">
        <p className="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
          Dónde vive y cómo se llega
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-stone-600">
            Dirección
            <input
              className={inputClass}
              value={borrador.direccion ?? ''}
              onChange={(e) => setBorrador({ ...borrador, direccion: e.target.value })}
              placeholder="Av. Banzer 3er anillo #120"
            />
          </label>
          <label className="text-xs text-stone-600">
            Ubicación en el mapa
            <input
              className={inputClass}
              value={borrador.ubicacion ?? ''}
              onChange={(e) => setBorrador({ ...borrador, ubicacion: e.target.value })}
              placeholder="-17.7695,-63.1980 o el enlace de Google Maps"
            />
          </label>
          <label className="text-xs text-stone-600 sm:col-span-2">
            Referencias para llegar
            <input
              className={inputClass}
              value={borrador.referencias ?? ''}
              onChange={(e) => setBorrador({ ...borrador, referencias: e.target.value })}
              placeholder="Portón verde, frente a la cancha, timbre del fondo"
            />
          </label>
          <label className="text-xs text-stone-600 sm:col-span-2">
            Nota interna
            <input
              className={inputClass}
              value={borrador.nota ?? ''}
              onChange={(e) => setBorrador({ ...borrador, nota: e.target.value })}
              placeholder="Atender después de las 18:00"
            />
          </label>
        </div>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={guardar} disabled={guardando} className={btnPrimary}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" onClick={() => setEditando(false)} className={btnSecondary}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
          Dónde vive y cómo se llega
        </p>
        {!soloLectura ? (
          <button type="button" onClick={abrirEdicion} className={`${btnSecondary} ml-auto`}>
            {vacia ? 'Cargar dirección' : 'Editar'}
          </button>
        ) : null}
      </div>

      {vacia ? (
        <p className="mt-1.5 text-xs text-stone-500">Todavía no cargamos dónde vive.</p>
      ) : (
        <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1 text-sm text-stone-700">
            {f?.direccion ? (
              <p className="flex flex-wrap items-center gap-2">
                <span>{f.direccion}</span>
                <Copiar valor={f.direccion}>Copiar dirección</Copiar>
              </p>
            ) : null}
            {f?.referencias ? <p className="text-xs text-stone-500">{f.referencias}</p> : null}
            {f?.nota ? <p className="text-xs text-stone-400">{f.nota}</p> : null}
            {q ? (
              <p className="flex flex-wrap items-center gap-2 pt-0.5">
                <a
                  href={enlaceDeMapa(q)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-100"
                >
                  Abrir en Google Maps ↗
                </a>
                <Copiar valor={enlaceDeMapa(q)}>Copiar enlace del mapa</Copiar>
                {f?.ubicacion ? <Copiar valor={f.ubicacion}>Copiar ubicación</Copiar> : null}
              </p>
            ) : null}
          </div>

          {embed ? (
            <iframe
              title="Ubicación en Google Maps"
              src={embed}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-40 w-full rounded-lg border border-stone-200 sm:w-64"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
