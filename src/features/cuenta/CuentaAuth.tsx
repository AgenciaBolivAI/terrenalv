'use client';

// El alta y el ingreso del COMPRADOR.
//
// Es otra puerta que la del equipo: /admin/login es del personal y esta es de
// quien compra. Comparten Supabase Auth pero no se cruzan — el personal vive
// en `profiles` y el comprador en `customers`, y crear_mi_cuenta rebota si
// alguien del equipo intenta registrarse acá.
//
// Se piden los datos con los que después se le va a escribir: el cumpleaños
// para saludarlo, la ciudad para saber de dónde viene la demanda, y cómo nos
// conoció para saber qué publicidad sirve. Nada de eso frena el alta: solo el
// nombre y el correo son obligatorios.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { btnPrimary, inputClass } from '@/features/admin/ui/bits';

const COMO_NOS_CONOCIO = [
  'Facebook o Instagram',
  'Un amigo o familiar',
  'Pasé por la urbanización',
  'Google',
  'Un vendedor de Terrenalv',
  'Otro',
];

export default function CuentaAuth({ modo }: { modo: 'entrar' | 'crear' }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [esAlta, setEsAlta] = useState(modo === 'crear');

  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [ci, setCi] = useState('');
  const [nacimiento, setNacimiento] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [comoConocio, setComoConocio] = useState('');
  const [permiso, setPermiso] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setBusy(true);

    if (esAlta) {
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password: clave,
      });
      if (err) {
        setBusy(false);
        setError(
          /already registered|already been/i.test(err.message)
            ? 'Ya hay una cuenta con ese correo. Entrá con tu contraseña.'
            : err.message,
        );
        return;
      }
      // Sin sesión = Supabase pidió confirmar el correo. La ficha se completa
      // en el primer ingreso; sin esto el alta se perdería en el aire.
      if (!data.session) {
        setBusy(false);
        setAviso(
          'Te mandamos un correo para confirmar tu cuenta. Abrilo y después entrá acá con tu contraseña.',
        );
        return;
      }
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: clave,
      });
      if (err) {
        setBusy(false);
        setError('Correo o contraseña incorrectos.');
        return;
      }
    }

    // Con sesión: se crea (o completa) la ficha del cliente. Es idempotente,
    // así que sirve tanto para el alta como para el ingreso.
    if (esAlta || nombre.trim()) {
      const { error: err } = await supabase.rpc('crear_mi_cuenta', {
        p_full_name: nombre.trim() || email.split('@')[0],
        p_phone: telefono.trim() || null,
        p_ci: ci.trim() || null,
        p_birth_date: nacimiento || null,
        p_city: ciudad.trim() || null,
        p_como_nos_conocio: comoConocio || null,
        p_marketing_opt_in: permiso,
      });
      if (err && !/CUENTA_DE_EQUIPO/.test(err.message)) {
        setBusy(false);
        setError('No pudimos guardar tus datos. Intentá de nuevo.');
        return;
      }
      if (err) {
        setBusy(false);
        setError('Esta cuenta es del equipo de Terrenalv. Ingresá desde el panel.');
        return;
      }
    }

    router.push('/cuenta/panel');
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold text-stone-600">Correo</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-stone-600">Contraseña</label>
        <input
          type="password"
          required
          minLength={8}
          autoComplete={esAlta ? 'new-password' : 'current-password'}
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          className={inputClass}
        />
        {esAlta ? <p className="mt-1 text-[11px] text-stone-500">Mínimo 8 caracteres.</p> : null}
      </div>

      {esAlta ? (
        <>
          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-600">
              Nombre completo
            </label>
            <input
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-stone-600">Celular</label>
              <input
                inputMode="tel"
                placeholder="+591 7xxxxxxx"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-stone-600">Carnet</label>
              <input value={ci} onChange={(e) => setCi(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-stone-600">
                Fecha de nacimiento
              </label>
              <input
                type="date"
                value={nacimiento}
                onChange={(e) => setNacimiento(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-stone-600">Ciudad</label>
              <input
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-600">
              ¿Cómo nos conociste?
            </label>
            <select
              value={comoConocio}
              onChange={(e) => setComoConocio(e.target.value)}
              className={inputClass}
            >
              <option value="">Prefiero no decir</option>
              {COMO_NOS_CONOCIO.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-start gap-2 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={permiso}
              onChange={(e) => setPermiso(e.target.checked)}
              className="mt-0.5"
            />
            Quiero recibir novedades de Terrenalv por correo (lotes nuevos, promociones y el saludo
            de mi cumpleaños). Podés darte de baja cuando quieras.
          </label>
        </>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {aviso ? (
        <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{aviso}</p>
      ) : null}

      <button type="submit" disabled={busy} className={`${btnPrimary} w-full justify-center`}>
        {busy ? 'Un momento…' : esAlta ? 'Crear mi cuenta' : 'Entrar'}
      </button>

      <p className="pt-1 text-center text-xs text-stone-500">
        {esAlta ? '¿Ya tenés cuenta?' : '¿Todavía no tenés cuenta?'}{' '}
        <button
          type="button"
          onClick={() => {
            setEsAlta((v) => !v);
            setError(null);
            setAviso(null);
          }}
          className="font-semibold text-brand underline"
        >
          {esAlta ? 'Entrar' : 'Creála acá'}
        </button>
      </p>
    </form>
  );
}
