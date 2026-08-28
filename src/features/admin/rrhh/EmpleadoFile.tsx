'use client';

// EL FILE DEL DEPENDIENTE.
//
// La contadora mandó la planilla de «DATOS PERSONALES» que usan en papel y
// pidió que RRHH sea «tipo kardex… esa información es muy útil para el file de
// cada dependiente». Estas secciones son esa hoja, en el mismo orden: datos
// personales, estudios, experiencia y referencias, lo laboral, la seguridad
// social, el banco, el contacto de emergencia y los papeles escaneados.
//
// La EDAD no se guarda: se calcula de la fecha de nacimiento. Un número que
// envejece solo en la base miente al año siguiente.
//
// Se edita todo de una vez y se guarda una sola vez: cinco guardados parciales
// serían cinco maneras de dejar el file a medias.

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { formatMoney } from '@/lib/format';
import { DocumentosEmpleado } from './DocumentosEmpleado';
import type { Empleado } from './tipos';

const ESTADO_CIVIL = [
  ['soltero', 'Soltero/a'],
  ['casado', 'Casado/a'],
  ['divorciado', 'Divorciado/a'],
  ['viudo', 'Viudo/a'],
  ['concubinato', 'Concubinato'],
] as const;

const TIPO_CONTRATO = [
  ['indefinido', 'Indefinido'],
  ['plazo_fijo', 'A plazo fijo'],
  ['obra', 'Por obra o servicio'],
  ['consultoria', 'Consultoría'],
] as const;

/** La edad de hoy, a partir del nacimiento. */
export function edadDe(fecha: string | null): number | null {
  if (!fecha) return null;
  const n = new Date(`${fecha}T12:00:00`);
  const hoy = new Date();
  let edad = hoy.getFullYear() - n.getFullYear();
  const m = hoy.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) edad -= 1;
  return edad >= 0 && edad < 130 ? edad : null;
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] tracking-wide text-stone-500 uppercase">{rotulo}</p>
      <p className="mt-0.5 text-sm text-stone-900">{children ?? <span className="text-stone-400">—</span>}</p>
    </div>
  );
}

function Campo({
  rotulo,
  value,
  onChange,
  type = 'text',
  ancho,
}: {
  rotulo: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  ancho?: boolean;
}) {
  return (
    <div className={ancho ? 'col-span-2' : undefined}>
      <label className="mb-1 block text-xs text-stone-500">{rotulo}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 p-3">
      <p className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">{titulo}</p>
      {children}
    </section>
  );
}

export function EmpleadoFile({
  empleado,
  onClose,
  onSaved,
}: {
  empleado: Empleado;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [editando, setEditando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(empleado);

  const set = (patch: Partial<Empleado>) => setF((prev) => ({ ...prev, ...patch }));
  const edad = edadDe(f.fecha_nacimiento);

  async function guardar() {
    setError(null);
    if (f.tipo_contrato && f.tipo_contrato !== 'indefinido' && !f.fecha_fin_contrato) {
      setError('Un contrato a plazo necesita su fecha de fin.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_guardar_empleado', {
      p_id: f.id,
      p_codigo: f.codigo,
      p_nombre: f.nombre_completo,
      p_ci: f.ci || null,
      p_telefono: f.telefono || null,
      p_correo: f.correo || null,
      p_cargo: f.cargo,
      p_area: f.area || null,
      p_project_id: f.project_id || null,
      p_centro_costo_id: f.centro_costo_id || null,
      p_profile_id: null,
      p_fecha_ingreso: f.fecha_ingreso,
      p_salario: Number(f.salario_mensual) || 0,
      p_nota: f.nota || null,
      p_fecha_nacimiento: f.fecha_nacimiento || null,
      p_direccion: f.direccion || null,
      p_nacionalidad: f.nacionalidad || null,
      p_estado_civil: f.estado_civil || null,
      p_profesion: f.profesion || null,
      p_estudios_primaria: f.estudios_primaria || null,
      p_estudios_secundaria: f.estudios_secundaria || null,
      p_estudios_tecnicos: f.estudios_tecnicos || null,
      p_estudios_universitarios: f.estudios_universitarios || null,
      p_experiencia_laboral: f.experiencia_laboral || null,
      p_referencias: f.referencias || null,
      p_emergencia_nombre: f.contacto_emergencia_nombre || null,
      p_emergencia_telefono: f.contacto_emergencia_telefono || null,
      p_emergencia_parentesco: f.contacto_emergencia_parentesco || null,
      p_afp: f.afp || null,
      p_nua: f.nua || null,
      p_caja_salud: f.caja_salud || null,
      p_banco: f.banco || null,
      p_cuenta_bancaria: f.cuenta_bancaria || null,
      p_tipo_contrato: f.tipo_contrato || null,
      p_fecha_fin_contrato: f.fecha_fin_contrato || null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push('File actualizado.', 'success');
    setEditando(false);
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} wide title={`File — ${f.codigo} · ${f.nombre_completo}`}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={f.estado === 'activo' ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-600'}>
            {f.estado === 'activo' ? 'En planilla' : 'Retirado'}
          </Badge>
          <span className="text-xs text-stone-500">
            {f.cargo}
            {f.area ? ` · ${f.area}` : ''} · desde {dateLabel(f.fecha_ingreso)}
          </span>
          {!editando ? (
            <button type="button" className={`${btnSecondary} ml-auto`} onClick={() => setEditando(true)}>
              Editar file
            </button>
          ) : null}
        </div>

        <Seccion titulo="Datos personales">
          {editando ? (
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Nombres y apellidos" value={f.nombre_completo} onChange={(v) => set({ nombre_completo: v })} ancho />
              <Campo rotulo="N° de C.I." value={f.ci ?? ''} onChange={(v) => set({ ci: v })} />
              <Campo rotulo="Fecha de nacimiento" type="date" value={f.fecha_nacimiento ?? ''} onChange={(v) => set({ fecha_nacimiento: v })} />
              <Campo rotulo="Nacionalidad" value={f.nacionalidad ?? ''} onChange={(v) => set({ nacionalidad: v })} />
              <div>
                <label className="mb-1 block text-xs text-stone-500">Estado civil</label>
                <select
                  value={f.estado_civil ?? ''}
                  onChange={(e) => set({ estado_civil: e.target.value })}
                  className={inputClass}
                >
                  <option value="">— sin indicar —</option>
                  {ESTADO_CIVIL.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <Campo rotulo="Profesión u oficio" value={f.profesion ?? ''} onChange={(v) => set({ profesion: v })} />
              <Campo rotulo="Celular" value={f.telefono ?? ''} onChange={(v) => set({ telefono: v })} />
              <Campo rotulo="Correo electrónico" type="email" value={f.correo ?? ''} onChange={(v) => set({ correo: v })} />
              <Campo rotulo="Dirección del domicilio" value={f.direccion ?? ''} onChange={(v) => set({ direccion: v })} ancho />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Dato rotulo="N° de C.I.">{f.ci}</Dato>
              <Dato rotulo="Nacimiento">
                {f.fecha_nacimiento ? `${dateLabel(f.fecha_nacimiento)}${edad !== null ? ` · ${edad} años` : ''}` : null}
              </Dato>
              <Dato rotulo="Nacionalidad">{f.nacionalidad}</Dato>
              <Dato rotulo="Estado civil">
                {ESTADO_CIVIL.find(([v]) => v === f.estado_civil)?.[1] ?? null}
              </Dato>
              <Dato rotulo="Profesión">{f.profesion}</Dato>
              <Dato rotulo="Celular">{f.telefono}</Dato>
              <Dato rotulo="Correo">{f.correo}</Dato>
              <Dato rotulo="Domicilio">{f.direccion}</Dato>
            </div>
          )}
        </Seccion>

        <Seccion titulo="Estudios realizados">
          {editando ? (
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Primaria" value={f.estudios_primaria ?? ''} onChange={(v) => set({ estudios_primaria: v })} />
              <Campo rotulo="Secundaria" value={f.estudios_secundaria ?? ''} onChange={(v) => set({ estudios_secundaria: v })} />
              <Campo rotulo="Técnicos" value={f.estudios_tecnicos ?? ''} onChange={(v) => set({ estudios_tecnicos: v })} />
              <Campo rotulo="Universitarios" value={f.estudios_universitarios ?? ''} onChange={(v) => set({ estudios_universitarios: v })} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Dato rotulo="Primaria">{f.estudios_primaria}</Dato>
              <Dato rotulo="Secundaria">{f.estudios_secundaria}</Dato>
              <Dato rotulo="Técnicos">{f.estudios_tecnicos}</Dato>
              <Dato rotulo="Universitarios">{f.estudios_universitarios}</Dato>
            </div>
          )}
        </Seccion>

        <Seccion titulo="Experiencia y referencias">
          {editando ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-stone-500">Experiencia laboral</label>
                <textarea
                  value={f.experiencia_laboral ?? ''}
                  onChange={(e) => set({ experiencia_laboral: e.target.value })}
                  rows={3}
                  placeholder="Dónde trabajó antes, en qué y cuánto tiempo."
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-500">
                  Referencias laborales y personales
                </label>
                <textarea
                  value={f.referencias ?? ''}
                  onChange={(e) => set({ referencias: e.target.value })}
                  rows={3}
                  placeholder="Nombre, relación y teléfono de cada referencia."
                  className={inputClass}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <div>
                <p className="text-[11px] tracking-wide text-stone-500 uppercase">Experiencia laboral</p>
                <p className="mt-0.5 whitespace-pre-wrap text-stone-900">
                  {f.experiencia_laboral ?? <span className="text-stone-400">—</span>}
                </p>
              </div>
              <div>
                <p className="text-[11px] tracking-wide text-stone-500 uppercase">Referencias</p>
                <p className="mt-0.5 whitespace-pre-wrap text-stone-900">
                  {f.referencias ?? <span className="text-stone-400">—</span>}
                </p>
              </div>
            </div>
          )}
        </Seccion>

        <Seccion titulo="Datos laborales">
          {editando ? (
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Cargo" value={f.cargo} onChange={(v) => set({ cargo: v })} />
              <Campo rotulo="Área en la que trabaja" value={f.area ?? ''} onChange={(v) => set({ area: v })} />
              <Campo rotulo="Fecha de ingreso" type="date" value={f.fecha_ingreso} onChange={(v) => set({ fecha_ingreso: v })} />
              <Campo rotulo="Sueldo mensual (Bs)" type="number" value={String(f.salario_mensual ?? '')} onChange={(v) => set({ salario_mensual: Number(v) })} />
              <div>
                <label className="mb-1 block text-xs text-stone-500">Tipo de contrato</label>
                <select
                  value={f.tipo_contrato ?? ''}
                  onChange={(e) => set({ tipo_contrato: e.target.value })}
                  className={inputClass}
                >
                  <option value="">— sin indicar —</option>
                  {TIPO_CONTRATO.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              {f.tipo_contrato && f.tipo_contrato !== 'indefinido' ? (
                <Campo rotulo="Fin de contrato" type="date" value={f.fecha_fin_contrato ?? ''} onChange={(v) => set({ fecha_fin_contrato: v })} />
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Dato rotulo="Cargo">{f.cargo}</Dato>
              <Dato rotulo="Área">{f.area}</Dato>
              <Dato rotulo="Ingreso">{dateLabel(f.fecha_ingreso)}</Dato>
              <Dato rotulo="Sueldo">{formatMoney(Number(f.salario_mensual), 'BOB')}</Dato>
              <Dato rotulo="Contrato">
                {TIPO_CONTRATO.find(([v]) => v === f.tipo_contrato)?.[1] ?? null}
              </Dato>
              <Dato rotulo="Fin de contrato">
                {f.fecha_fin_contrato ? dateLabel(f.fecha_fin_contrato) : null}
              </Dato>
            </div>
          )}
        </Seccion>

        <Seccion titulo="Seguridad social y banco">
          {editando ? (
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="AFP" value={f.afp ?? ''} onChange={(v) => set({ afp: v })} />
              <Campo rotulo="NUA / CUA" value={f.nua ?? ''} onChange={(v) => set({ nua: v })} />
              <Campo rotulo="Caja de salud" value={f.caja_salud ?? ''} onChange={(v) => set({ caja_salud: v })} />
              <Campo rotulo="Banco" value={f.banco ?? ''} onChange={(v) => set({ banco: v })} />
              <Campo rotulo="N° de cuenta" value={f.cuenta_bancaria ?? ''} onChange={(v) => set({ cuenta_bancaria: v })} ancho />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Dato rotulo="AFP">{f.afp}</Dato>
              <Dato rotulo="NUA / CUA">{f.nua}</Dato>
              <Dato rotulo="Caja de salud">{f.caja_salud}</Dato>
              <Dato rotulo="Banco">
                {f.banco}
                {f.cuenta_bancaria ? (
                  <span className="block text-[11px] text-stone-500">{f.cuenta_bancaria}</span>
                ) : null}
              </Dato>
            </div>
          )}
        </Seccion>

        <Seccion titulo="Contacto de emergencia">
          {editando ? (
            <div className="grid grid-cols-3 gap-3">
              <Campo rotulo="Nombre" value={f.contacto_emergencia_nombre ?? ''} onChange={(v) => set({ contacto_emergencia_nombre: v })} />
              <Campo rotulo="Teléfono" value={f.contacto_emergencia_telefono ?? ''} onChange={(v) => set({ contacto_emergencia_telefono: v })} />
              <Campo rotulo="Parentesco" value={f.contacto_emergencia_parentesco ?? ''} onChange={(v) => set({ contacto_emergencia_parentesco: v })} />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Dato rotulo="Nombre">{f.contacto_emergencia_nombre}</Dato>
              <Dato rotulo="Teléfono">{f.contacto_emergencia_telefono}</Dato>
              <Dato rotulo="Parentesco">{f.contacto_emergencia_parentesco}</Dato>
            </div>
          )}
        </Seccion>

        {/* El croquis del domicilio también vive acá, como un documento más. */}
        <DocumentosEmpleado empleadoId={f.id} />

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        {editando ? (
          <>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => {
                setF(empleado);
                setEditando(false);
                setError(null);
              }}
            >
              Cancelar
            </button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void guardar()}>
              {busy ? 'Guardando…' : 'Guardar file'}
            </button>
          </>
        ) : (
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cerrar
          </button>
        )}
      </div>
    </Dialog>
  );
}
