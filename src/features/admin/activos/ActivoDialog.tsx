'use client';

// ALTA Y EDICIÓN DE UN ACTIVO FIJO.
//
// La contadora pidió lo que faltaba: «número de factura, datos del proveedor
// (tipo kardex). También las cuentas contables que serán relacionadas o
// afectadas si se pagó al contado o crédito».
//
// Las tres cosas están acá. Y la cuenta que se va a debitar se muestra de
// verdad —la de la categoría elegida, no un texto genérico— porque registrar
// un activo ahora ASIENTA su compra, y quien lo carga tiene derecho a ver el
// asiento antes de guardarlo.

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { FormaPagoPicker, type FormaPago } from '@/features/admin/contabilidad/FormaPago';
import { useTesoreria } from '@/features/admin/contabilidad/Tesoreria';
import type { AdminProject } from '@/features/admin/lib/project-types';
import type { Activo, Categoria } from './tipos';
import { hoyBolivia } from '@/features/admin/lib/lapaz';

export function ActivoDialog({
  activo,
  cats,
  projects,
  defaultProjectId,
  onClose,
  onSaved,
}: {
  /** null = alta. */
  activo: Activo | null;
  cats: Categoria[];
  projects: AdminProject[];
  defaultProjectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { cuentas, contactos } = useTesoreria({
    contactKinds: ['proveedor', 'empleado', 'otro'],
  });

  const hoy = hoyBolivia();
  const [projectIdSel, setProjectIdSel] = useState(activo?.project_id ?? defaultProjectId);
  const [codigo, setCodigo] = useState(activo?.codigo ?? '');
  const [nombre, setNombre] = useState(activo?.nombre ?? '');
  const [categoriaId, setCategoriaId] = useState(activo?.categoria_id ?? '');
  const [identificacion, setIdentificacion] = useState(activo?.identificacion ?? '');
  const [costo, setCosto] = useState(activo ? String(activo.costo) : '');
  const [residual, setResidual] = useState(activo ? String(activo.valor_residual) : '0');
  const [fechaCompra, setFechaCompra] = useState(activo?.fecha_compra ?? hoy);
  const [vida, setVida] = useState(activo ? String(activo.vida_util_meses) : '');
  const [proveedorId, setProveedorId] = useState(activo?.proveedor_contact_id ?? '');
  const [numeroFactura, setNumeroFactura] = useState(activo?.numero_factura ?? '');
  const [centroId, setCentroId] = useState(activo?.centro_costo_id ?? '');
  const [centros, setCentros] = useState<
    { id: string; codigo: string; nombre: string; project_id: string | null }[]
  >([]);
  const [descripcion, setDescripcion] = useState(activo?.descripcion ?? '');
  const [nota, setNota] = useState(activo?.nota ?? '');
  const [titular, setTitular] = useState<'empresa' | 'tercero'>(
    (activo?.titular as 'empresa' | 'tercero') ?? 'empresa',
  );
  const [titularNombre, setTitularNombre] = useState(activo?.titular_nombre ?? '');
  const [formaPago, setFormaPago] = useState<FormaPago>(
    (activo?.forma_pago as FormaPago) ?? 'contado',
  );
  const [cuentaId, setCuentaId] = useState(activo?.treasury_account_id ?? '');
  const [vencimiento, setVencimiento] = useState(activo?.vencimiento ?? '');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('centros_costo')
        .select('id, codigo, nombre, project_id')
        .eq('is_active', true)
        .or(`project_id.eq.${projectIdSel},project_id.is.null`)
        .order('codigo');
      const cc = (data ?? []) as {
        id: string;
        codigo: string;
        nombre: string;
        project_id: string | null;
      }[];
      setCentros(cc);
      setCentroId((a) => (cc.some((c) => c.id === a) ? a : ''));
    })();
  }, [supabase, projectIdSel]);

  // Los centros propios de la urbanización van aparte de los de toda la
  // empresa, para que no se cargue una obra ajena por elegir mal en una lista
  // mezclada.
  const centrosDeAca = centros.filter((c) => c.project_id !== null);
  const centrosDeEmpresa = centros.filter((c) => c.project_id === null);

  const categoria = cats.find((c) => c.id === categoriaId);
  const proveedor = contactos.find((c) => c.id === proveedorId);
  // La cuenta de activo de la categoría: es la que se va a debitar.
  const cuentaDebito = categoria?.cuenta_activo
    ? `${categoria.cuenta_activo} · ${categoria.nombre}`
    : null;

  async function guardar() {
    setError(null);
    if (!codigo.trim() || !nombre.trim()) {
      setError('El código y el nombre son obligatorios.');
      return;
    }
    if (!categoriaId) {
      setError('Elegí la categoría: de ahí salen la vida útil y la cuenta contable.');
      return;
    }
    if (!(Number(costo) > 0)) {
      setError('El costo tiene que ser mayor a cero.');
      return;
    }
    if (formaPago === 'credito' && !vencimiento) {
      setError('Una compra a crédito necesita fecha de vencimiento.');
      return;
    }
    if (titular === 'tercero' && !titularNombre.trim()) {
      setError('Si el activo está a nombre de un tercero, decinos de quién.');
      return;
    }

    setBusy(true);
    const { error: err } = await supabase.rpc('admin_guardar_activo', {
      p_id: activo?.id ?? null,
      p_project_id: projectIdSel,
      p_categoria_id: categoriaId,
      p_codigo: codigo.trim(),
      p_nombre: nombre.trim(),
      p_descripcion: descripcion.trim() || null,
      p_identificacion: identificacion.trim() || null,
      p_fecha_compra: fechaCompra,
      p_fecha_alta: fechaCompra,
      p_costo: Number(costo),
      p_valor_residual: Number(residual) || 0,
      p_vida_util_meses: vida === '' ? null : Number(vida),
      p_centro_costo_id: centroId || null,
      p_proveedor_contact_id: proveedorId || null,
      p_expense_id: null,
      p_titular: titular,
      p_titular_nombre: titular === 'tercero' ? titularNombre.trim() : null,
      p_nota: nota.trim() || null,
      p_numero_factura: numeroFactura.trim() || null,
      p_forma_pago: formaPago,
      p_vencimiento: formaPago === 'credito' ? vencimiento : null,
      p_treasury_account_id: formaPago === 'contado' ? cuentaId || null : null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push(activo ? 'Activo actualizado.' : 'Activo registrado. Ya está depreciando.', 'success');
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} wide title={activo ? 'Editar activo fijo' : 'Nuevo activo fijo'}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-stone-500">¿De qué urbanización es?</label>
          <select
            value={projectIdSel}
            onChange={(e) => setProjectIdSel(e.target.value)}
            className={inputClass}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-stone-500">
            Lo de la oficina —computadoras, muebles, la camioneta de la empresa— va en
            «Administración».
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Código</label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="VEH-001"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Toyota Hilux 2024"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Categoría</label>
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className={inputClass}
            >
              <option value="">— elegir —</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} · {c.vida_util_meses} meses
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">
              Identificación (placa, serie)
            </label>
            <input
              value={identificacion}
              onChange={(e) => setIdentificacion(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {/* Los datos del papel: proveedor y factura. */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Proveedor</label>
            <select
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
              className={inputClass}
            >
              <option value="">— sin proveedor —</option>
              {contactos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {proveedor ? (
              <p className="mt-1 text-[11px] text-stone-500">
                {proveedor.tax_id ? `NIT ${proveedor.tax_id}` : 'sin NIT cargado'}
                {proveedor.phone ? ` · ${proveedor.phone}` : ''}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-stone-400">
                Se cargan en Contabilidad → Directorio.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">N° de factura</label>
            <input
              value={numeroFactura}
              onChange={(e) => setNumeroFactura(e.target.value)}
              placeholder="Ej. 001234"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Costo (Bs)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={costo}
              onChange={(e) => setCosto(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Valor residual (Bs)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={residual}
              onChange={(e) => setResidual(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-stone-500">
              Lo que valdrá al final de su vida útil. Cero si se gasta entero.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Fecha de compra</label>
            <input
              type="date"
              value={fechaCompra}
              onChange={(e) => setFechaCompra(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">
              Vida útil (meses — vacío usa la de la categoría)
            </label>
            <input
              type="number"
              min={1}
              value={vida}
              onChange={(e) => setVida(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <FormaPagoPicker
          value={formaPago}
          onChange={setFormaPago}
          cuentas={cuentas}
          cuentaId={cuentaId}
          onCuentaId={setCuentaId}
          vencimiento={vencimiento}
          onVencimiento={setVencimiento}
          monto={Number(costo)}
          cuentaDebito={cuentaDebito}
          conFondos={false}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Centro de costos</label>
            <select
              value={centroId}
              onChange={(e) => setCentroId(e.target.value)}
              className={inputClass}
            >
              <option value="">— sin centro —</option>
              {centrosDeAca.length > 0 ? (
                <optgroup label="De esta urbanización">
                  {centrosDeAca.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.nombre}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {centrosDeEmpresa.length > 0 ? (
                <optgroup label="De toda la empresa">
                  {centrosDeEmpresa.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.nombre}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">A nombre de</label>
            <select
              value={titular}
              onChange={(e) => setTitular(e.target.value as 'empresa' | 'tercero')}
              className={inputClass}
            >
              <option value="empresa">La empresa</option>
              <option value="tercero">Un tercero</option>
            </select>
            {titular === 'tercero' ? (
              <input
                value={titularNombre}
                onChange={(e) => setTitularNombre(e.target.value)}
                placeholder="¿De quién?"
                className={`${inputClass} mt-2`}
              />
            ) : null}
          </div>
        </div>

        <input
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Descripción (opcional)"
          className={inputClass}
        />
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          placeholder="Nota (opcional)"
          className={inputClass}
        />

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void guardar()}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Dialog>
  );
}
