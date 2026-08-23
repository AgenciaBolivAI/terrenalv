'use client';

// Bancos, cajas y directorio de terceros.
//
// El problema que resuelve: hasta acá toda la plata caía en una sola cuenta
// contable, "1111 Caja y Bancos". Lo que entró por el Banco Ganadero, lo que
// se cobró en efectivo en el mostrador y lo que salió por transferencia se
// sumaban en la misma línea. Con eso es imposible conciliar un extracto
// bancario: el sistema dice "hay Bs 40.000" y el banco dice otra cosa, y no hay
// forma de saber cuál de los dos movimientos falta.
//
// Ahora cada banco y cada caja tiene SU cuenta en el plan (1111.01, 1111.02…),
// así que su saldo contable es directamente la cifra que se compara contra el
// extracto.
//
// El traspaso entre cuentas propias se asienta como comprobante y no como
// ingreso ni egreso: es la misma plata cambiando de lugar. Si se registrara
// como las otras dos cosas, mover Bs 1.200 del banco a la caja chica inflaría
// las ventas del mes en Bs 1.200.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, EmptyState, Kpi, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';
import { RankBars } from '@/features/admin/analitica/Charts';
import { dateLabel, todayIso, type Currency } from './types';

export type TreasuryKind = 'banco' | 'caja' | 'billetera';
export type ContactKind = 'proveedor' | 'cliente' | 'empleado' | 'otro';

export interface TreasuryAccount {
  id: string;
  kind: TreasuryKind;
  name: string;
  bank_name: string | null;
  account_number: string | null;
  currency: Currency;
  account_code: string;
  is_active: boolean;
  opening_balance: number;
  opening_date: string | null;
  entradas: number;
  salidas: number;
  saldo: number;
  ultimo_movimiento: string | null;
  movimientos: number;
}

export interface Contact {
  id: string;
  kind: ContactKind;
  name: string;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
}

const KIND_LABEL: Record<TreasuryKind, string> = {
  banco: 'Banco',
  caja: 'Caja',
  billetera: 'Billetera',
};

const CONTACT_LABEL: Record<ContactKind, string> = {
  proveedor: 'Proveedor',
  cliente: 'Cliente',
  empleado: 'Empleado',
  otro: 'Otro',
};

const CONTACT_KINDS: ContactKind[] = ['proveedor', 'cliente', 'empleado', 'otro'];

/**
 * Cuentas activas y contactos, para los formularios de pago y egreso.
 *
 * Va como hook y no como fetch repetido en cada diálogo para que ambos vean
 * exactamente la misma lista: si uno filtrara las inactivas y el otro no, el
 * mismo egreso podría cargarse contra una cuenta cerrada.
 */
export function useTesoreria(opts?: { contactKinds?: ContactKind[] }) {
  const supabase = useMemo(() => createClient(), []);
  const kinds = opts?.contactKinds;
  const kindKey = kinds ? kinds.join(',') : '';
  const [cuentas, setCuentas] = useState<TreasuryAccount[]>([]);
  const [contactos, setContactos] = useState<Contact[]>([]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      let q = supabase.from('contacts').select('*').eq('is_active', true).order('name');
      if (kindKey) q = q.in('kind', kindKey.split(','));
      const [t, c] = await Promise.all([
        supabase.from('v_tesoreria_saldos').select('*').eq('is_active', true).order('name'),
        q,
      ]);
      if (!vivo) return;
      setCuentas((t.data ?? []) as TreasuryAccount[]);
      setContactos((c.data ?? []) as Contact[]);
    })();
    return () => {
      vivo = false;
    };
  }, [supabase, kindKey]);

  return { cuentas, contactos };
}

/**
 * Selector de "por dónde pasó la plata", igual en el formulario de cobro y en
 * el de egreso.
 */
export function CuentaSelect({
  cuentas,
  value,
  onChange,
  label,
  monto,
  signo,
}: {
  cuentas: TreasuryAccount[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** Para adelantar cómo queda el saldo antes de guardar. */
  monto?: number;
  signo: 1 | -1;
}) {
  const cuenta = cuentas.find((a) => a.id === value);
  const queda = cuenta ? Number(cuenta.saldo) + signo * Number(monto || 0) : 0;

  return (
    <div>
      <label className="mb-1 block text-xs text-stone-500">{label}</label>
      {cuentas.length ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">— sin especificar —</option>
          {cuentas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {formatMoney(Number(a.saldo), a.currency)}
            </option>
          ))}
        </select>
      ) : (
        <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-500">
          Todavía no hay bancos ni cajas cargados. Se puede guardar igual, pero el movimiento va a
          quedar en la cuenta genérica <strong>1111 Caja y Bancos</strong>, que junta todo y no se
          puede conciliar contra un extracto.
        </p>
      )}
      {cuenta && Number(monto) > 0 ? (
        <p className={`mt-1 text-xs ${queda < 0 ? 'text-red-600' : 'text-stone-500'}`}>
          {cuenta.name} quedaría en{' '}
          <strong className="tabular-nums">{formatMoney(queda, cuenta.currency)}</strong>
          {queda < 0 ? ' — en negativo.' : '.'}
        </p>
      ) : null}
    </div>
  );
}

/* ========================================================================== */
/* Bancos y caja                                                              */
/* ========================================================================== */

export default function Tesoreria({
  projectId,
  projectName,
  currency,
  onVerLibro,
}: {
  /** Los saldos son de la empresa (una cuenta bancaria no es de un proyecto),
   *  pero el asiento del traspaso se registra en una gestión concreta. */
  projectId: string;
  projectName: string;
  currency: Currency;
  /** Abre el libro filtrado por la cuenta contable de un banco o caja: es el
   *  "ver los movimientos de esta cuenta" que exige la regla de tiles.
   *
   *  Manda tambien desde cuando: el saldo que muestra el tile es de toda la
   *  vida de la cuenta, asi que abrir el libro en el mes corriente mostraria
   *  una lista que no suma lo que dice el tile. */
  onVerLibro: (accountCode: string, desde?: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();

  const [rows, setRows] = useState<TreasuryAccount[] | null>(null);
  const [editing, setEditing] = useState<TreasuryAccount | 'nueva' | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('v_tesoreria_saldos')
      .select('*')
      .order('kind')
      .order('name');
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      setRows([]);
      return;
    }
    setRows((data ?? []) as TreasuryAccount[]);
  }, [supabase, push]);

  useEffect(() => {
    void load();
  }, [load]);

  const activas = useMemo(() => (rows ?? []).filter((r) => r.is_active), [rows]);
  const enBancos = useMemo(
    () => activas.filter((r) => r.kind === 'banco').reduce((s, r) => s + Number(r.saldo), 0),
    [activas],
  );
  const enCajas = useMemo(
    () => activas.filter((r) => r.kind !== 'banco').reduce((s, r) => s + Number(r.saldo), 0),
    [activas],
  );
  const enRojo = useMemo(() => activas.filter((r) => Number(r.saldo) < 0), [activas]);
  // Una cuenta cerrada que todavia tiene plata: el total de arriba no la suma,
  // pero la fila si la muestra, asi que los dos numeros no coinciden. Es un
  // estado roto de verdad — se cierra una cuenta despues de vaciarla.
  const cerradasConPlata = useMemo(
    () => (rows ?? []).filter((r) => !r.is_active && Number(r.saldo) !== 0),
    [rows],
  );

  if (rows === null) return <Spinner label="Cargando cuentas…" />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="En bancos"
          value={formatMoney(enBancos, currency)}
          hint={`${activas.filter((r) => r.kind === 'banco').length} cuenta(s)`}
          onClick={() => {
            const b = activas.find((r) => r.kind === 'banco');
            if (b) onVerLibro(b.account_code, b.opening_date ?? undefined);
          }}
        />
        <Kpi
          label="En caja"
          value={formatMoney(enCajas, currency)}
          hint={`${activas.filter((r) => r.kind !== 'banco').length} caja(s)`}
          onClick={() => {
            const c = activas.find((r) => r.kind !== 'banco');
            if (c) onVerLibro(c.account_code, c.opening_date ?? undefined);
          }}
        />
        <Kpi
          label="Disponible total"
          value={formatMoney(enBancos + enCajas, currency)}
          tone={enRojo.length ? 'bad' : 'good'}
          hint={
            enRojo.length
              ? `${enRojo.length} cuenta(s) en negativo`
              : 'Suma de todas las cuentas activas'
          }
          onClick={() => {
            const r = enRojo[0] ?? activas[0];
            if (r) onVerLibro(r.account_code, r.opening_date ?? undefined);
          }}
        />
      </div>

      {cerradasConPlata.length ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>
            {cerradasConPlata.length === 1
              ? 'Una cuenta inactiva todavía tiene saldo'
              : `${cerradasConPlata.length} cuentas inactivas todavía tienen saldo`}
          </strong>{' '}
          ({cerradasConPlata.map((r) => r.name).join(', ')}). No entran en el disponible de arriba,
          así que ese total y las filas de abajo no van a coincidir. Transferí el saldo a otra
          cuenta antes de dejarlas inactivas.
        </p>
      ) : null}

      {enRojo.length ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>
            {enRojo.length === 1 ? 'Una cuenta está' : `${enRojo.length} cuentas están`} en negativo
          </strong>{' '}
          ({enRojo.map((r) => r.name).join(', ')}). O falta registrar un depósito, o el saldo
          inicial que se cargó no era el correcto.
        </p>
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
          <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Bancos y cajas
          </h2>
          <div className="ml-auto">
            <ExportButtons
              disabled={!rows.length}
              orientation="landscape"
              meta={{
                title: 'Bancos y Cajas',
                subtitle: projectName,
                filename: `bancos-y-cajas-${todayIso()}`,
                footnote:
                  'Saldo = saldo inicial más todo lo registrado en la cuenta contable de cada una. Es la cifra a comparar contra el extracto bancario.',
              }}
              columns={[
                { header: 'Tipo' },
                { header: 'Cuenta' },
                { header: 'Banco' },
                { header: 'N° de cuenta' },
                { header: 'Contable' },
                { header: 'Inicial', align: 'right' },
                { header: 'Entradas', align: 'right' },
                { header: 'Salidas', align: 'right' },
                { header: 'Saldo', align: 'right' },
              ]}
              rows={() =>
                rows.map((r) => [
                  KIND_LABEL[r.kind],
                  r.name,
                  r.bank_name ?? '',
                  r.account_number ?? '',
                  r.account_code,
                  fnum(Number(r.opening_balance)),
                  fnum(Number(r.entradas)),
                  fnum(Number(r.salidas)),
                  fnum(Number(r.saldo)),
                ]) as XCell[][]
              }
            />
          </div>
          <button
            type="button"
            className={btnSecondary}
            disabled={activas.length < 2}
            title={activas.length < 2 ? 'Se necesitan al menos dos cuentas' : undefined}
            onClick={() => setTransferOpen(true)}
          >
            Transferir
          </button>
          <button type="button" className={btnPrimary} onClick={() => setEditing('nueva')}>
            Nueva cuenta
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title="Todavía no hay bancos ni cajas cargados"
              hint="Cargá cada cuenta bancaria y cada caja con su saldo actual. Desde ahí cada cobro y cada egreso dice por dónde pasó la plata, y el saldo del sistema se puede comparar contra el extracto del banco."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Cuenta</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Banco / N°</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Contable</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Entradas
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Salidas
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Saldo</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Último mov.</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                      r.is_active ? '' : 'opacity-55'
                    }`}
                    onClick={() => onVerLibro(r.account_code, r.opening_date ?? undefined)}
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium text-stone-900">{r.name}</span>
                      <Badge className="ml-2 bg-stone-100 text-stone-600">{KIND_LABEL[r.kind]}</Badge>
                      {r.is_active ? null : (
                        <Badge className="ml-1 bg-stone-200 text-stone-600">Inactiva</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-stone-500">
                      {r.bank_name ?? '—'}
                      {r.account_number ? (
                        <span className="block text-xs tabular-nums">{r.account_number}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-stone-500">{r.account_code}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                      {formatMoney(Number(r.entradas), r.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                      {formatMoney(Number(r.salidas), r.currency)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        Number(r.saldo) < 0 ? 'text-red-600' : 'text-stone-900'
                      }`}
                    >
                      {formatMoney(Number(r.saldo), r.currency)}
                    </td>
                    <td className="px-3 py-2 text-xs text-stone-400">
                      {r.ultimo_movimiento ? dateLabel(r.ultimo_movimiento) : 'sin movimientos'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setEditing(r);
                        }}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing ? (
        <TreasuryDialog
          account={editing === 'nueva' ? null : editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {transferOpen ? (
        <TransferDialog
          projectId={projectId}
          accounts={activas}
          onClose={() => setTransferOpen(false)}
          onSaved={() => {
            setTransferOpen(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TreasuryDialog({
  account,
  currency,
  onClose,
  onSaved,
}: {
  account: TreasuryAccount | null;
  currency: Currency;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [kind, setKind] = useState<TreasuryKind>(account?.kind ?? 'banco');
  const [name, setName] = useState(account?.name ?? '');
  const [bankName, setBankName] = useState(account?.bank_name ?? '');
  const [accountNumber, setAccountNumber] = useState(account?.account_number ?? '');
  const [opening, setOpening] = useState(account ? String(account.opening_balance) : '');
  const [openingDate, setOpeningDate] = useState(account?.opening_date ?? todayIso());
  const [isActive, setIsActive] = useState(account?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError('Ponele un nombre a la cuenta.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_upsert_treasury', {
      p_name: name.trim(),
      p_kind: kind,
      p_bank_name: bankName.trim() || null,
      p_account_number: accountNumber.trim() || null,
      p_currency: currency,
      p_opening_balance: account ? account.opening_balance : Number(opening || 0),
      p_opening_date: account ? account.opening_date : openingDate,
      p_id: account?.id ?? null,
      p_is_active: isActive,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push(account ? 'Cuenta actualizada.' : 'Cuenta creada.', 'success');
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={account ? 'Editar cuenta' : 'Nueva cuenta'}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Tipo</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TreasuryKind)}
              className={inputClass}
            >
              {(Object.keys(KIND_LABEL) as TreasuryKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'banco' ? 'Cta Cte Banco Ganadero' : 'Caja chica oficina'}
              className={inputClass}
            />
          </div>
        </div>

        {kind === 'banco' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">Banco</label>
              <input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Banco Ganadero"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">N° de cuenta</label>
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        ) : null}

        {account ? (
          <>
            <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-500">
              Saldo inicial <strong>{formatMoney(Number(account.opening_balance), currency)}</strong>{' '}
              al {account.opening_date ? dateLabel(account.opening_date) : '—'}. No se edita: cambiar
              el punto de partida movería el saldo de todos los meses ya cerrados. Si estaba mal,
              corregilo con un comprobante de ajuste.
            </p>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Cuenta activa
            </label>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">
                Saldo actual ({currency === 'BOB' ? 'Bs' : '$us'})
              </label>
              <input
                type="number"
                step="0.01"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">A la fecha</label>
              <input
                type="date"
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        )}

        {account ? null : (
          <p className="text-xs text-stone-500">
            Poné el saldo que tiene hoy según el extracto o el arqueo. Desde ahí el sistema suma y
            resta cada movimiento que registres.
          </p>
        )}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function TransferDialog({
  projectId,
  accounts,
  onClose,
  onSaved,
}: {
  projectId: string;
  accounts: TreasuryAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [from, setFrom] = useState(accounts[0]?.id ?? '');
  const [to, setTo] = useState(accounts[1]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origen = accounts.find((a) => a.id === from);
  const monto = Number(amount || 0);
  const quedaria = origen ? Number(origen.saldo) - monto : 0;

  async function save() {
    setError(null);
    if (from === to) {
      setError('Elegí dos cuentas distintas.');
      return;
    }
    if (!(monto > 0)) {
      setError('El monto debe ser mayor a cero.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_transfer_funds', {
      p_project_id: projectId,
      p_from: from,
      p_to: to,
      p_amount: monto,
      p_date: date,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push('Transferencia registrada.', 'success');
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} title="Transferir entre cuentas">
      <div className="space-y-3">
        <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-500">
          Mover plata entre cuentas propias no es un ingreso ni un gasto: queda como comprobante en
          el libro y no toca el resultado del mes.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Desde</label>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {formatMoney(Number(a.saldo), a.currency)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Hacia</label>
            <select value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {formatMoney(Number(a.saldo), a.currency)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Monto</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Fecha</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Concepto (ej. reposición de caja chica)"
          className={inputClass}
        />
        {origen && monto > 0 ? (
          <p className={`text-xs ${quedaria < 0 ? 'text-red-600' : 'text-stone-500'}`}>
            {origen.name} quedaría en{' '}
            <strong className="tabular-nums">{formatMoney(quedaria, origen.currency)}</strong>
            {quedaria < 0 ? ' — en negativo.' : '.'}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Registrando…' : 'Transferir'}
        </button>
      </div>
    </Dialog>
  );
}

/* ========================================================================== */
/* Directorio                                                                 */
/* ========================================================================== */

interface ProveedorRow {
  proveedor: string;
  contact_id: string | null;
  tax_id: string | null;
  total: number;
  egresos: number;
  primero: string;
  ultimo: string;
}

export function Directorio({
  projectId,
  projectName,
  currency,
}: {
  /** null = ranking de proveedores de todas las urbanizaciones. */
  projectId: string | null;
  projectName: string;
  currency: Currency;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();

  const [rows, setRows] = useState<Contact[] | null>(null);
  const [ranking, setRanking] = useState<ProveedorRow[]>([]);
  const [filtro, setFiltro] = useState<ContactKind | 'todos'>('todos');
  const [buscar, setBuscar] = useState('');
  const [editing, setEditing] = useState<Contact | 'nuevo' | null>(null);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      supabase.from('contacts').select('*').order('name'),
      (projectId === null
        ? supabase.from('v_an_proveedores').select('*')
        : supabase.from('v_an_proveedores').select('*').eq('project_id', projectId)
      )
        .order('total', { ascending: false })
        .limit(10),
    ]);
    if (c.error) {
      push(adminErrorCopy(c.error.message), 'error');
      setRows([]);
    } else {
      setRows((c.data ?? []) as Contact[]);
    }
    setRanking((r.data ?? []) as ProveedorRow[]);
  }, [supabase, push, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (rows ?? []).filter(
      (c) =>
        (filtro === 'todos' || c.kind === filtro) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          (c.tax_id ?? '').includes(q) ||
          (c.phone ?? '').includes(q)),
    );
  }, [rows, filtro, buscar]);

  if (rows === null) return <Spinner label="Cargando directorio…" />;

  return (
    <div className="space-y-5">
      {ranking.length ? (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            En qué proveedores se va la plata
          </h2>
          <p className="mt-1 mb-3 text-xs text-stone-400">
            Los diez con más egresos acumulados. Un proveedor que no está en el directorio aparece
            con el nombre tal como se escribió en cada egreso.
          </p>
          <RankBars
            rows={ranking.map((p) => ({
              label: p.proveedor,
              value: Number(p.total),
              hint: `${p.egresos} egr.`,
            }))}
            format={(n) => formatMoney(n, currency)}
          />
        </section>
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
          <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Directorio
          </h2>
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as ContactKind | 'todos')}
            className={`${inputClass} w-auto`}
          >
            <option value="todos">Todos</option>
            {CONTACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {CONTACT_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar por nombre, NIT o teléfono"
            className={`${inputClass} w-auto min-w-60`}
          />
          <div className="ml-auto">
            <ExportButtons
              disabled={!visibles.length}
              meta={{
                title: 'Directorio',
                subtitle: projectName,
                filename: `directorio-${todayIso()}`,
              }}
              columns={[
                { header: 'Tipo' },
                { header: 'Nombre' },
                { header: 'NIT / CI' },
                { header: 'Teléfono' },
                { header: 'Correo' },
                { header: 'Dirección' },
              ]}
              rows={() =>
                visibles.map((c) => [
                  CONTACT_LABEL[c.kind],
                  c.name,
                  c.tax_id ?? '',
                  c.phone ?? '',
                  c.email ?? '',
                  c.address ?? '',
                ]) as XCell[][]
              }
            />
          </div>
          <button type="button" className={btnPrimary} onClick={() => setEditing('nuevo')}>
            Nuevo contacto
          </button>
        </div>

        {visibles.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title={rows.length ? 'Ningún contacto coincide' : 'El directorio está vacío'}
              hint={
                rows.length
                  ? 'Probá con otro filtro o limpiá la búsqueda.'
                  : 'Cargá los proveedores con los que trabajan. Elegirlos de una lista en vez de escribirlos a mano es lo que hace que el reporte por proveedor sirva: escrito a mano, el mismo proveedor termina contado tres veces.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-175 text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Nombre</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Tipo</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">NIT / CI</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Teléfono</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Correo</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => (
                  <tr
                    key={c.id}
                    className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                      c.is_active ? '' : 'opacity-55'
                    }`}
                    onClick={() => setEditing(c)}
                  >
                    <td className="px-4 py-2 font-medium text-stone-900">
                      {c.name}
                      {c.is_active ? null : (
                        <Badge className="ml-2 bg-stone-200 text-stone-600">Inactivo</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className="bg-stone-100 text-stone-700">{CONTACT_LABEL[c.kind]}</Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-stone-600">{c.tax_id ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-stone-600">{c.phone ?? '—'}</td>
                    <td className="px-3 py-2 text-stone-500">{c.email ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setEditing(c);
                        }}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing ? (
        <ContactDialog
          contact={editing === 'nuevo' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ContactDialog({
  contact,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [kind, setKind] = useState<ContactKind>(contact?.kind ?? 'proveedor');
  const [name, setName] = useState(contact?.name ?? '');
  const [taxId, setTaxId] = useState(contact?.tax_id ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [address, setAddress] = useState(contact?.address ?? '');
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [isActive, setIsActive] = useState(contact?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError('Falta el nombre.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_upsert_contact', {
      p_name: name.trim(),
      p_kind: kind,
      p_tax_id: taxId.trim() || null,
      p_phone: phone.trim() || null,
      p_email: email.trim() || null,
      p_address: address.trim() || null,
      p_notes: notes.trim() || null,
      p_id: contact?.id ?? null,
      p_is_active: isActive,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push(contact ? 'Contacto actualizado.' : 'Contacto creado.', 'success');
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={contact ? 'Editar contacto' : 'Nuevo contacto'}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Tipo</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ContactKind)}
              className={inputClass}
            >
              {CONTACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONTACT_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">NIT / CI</label>
            <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className={inputClass} />
          </div>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Razón social o nombre"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Teléfono"
            className={inputClass}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Correo"
            className={inputClass}
          />
        </div>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Dirección"
          className={inputClass}
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Notas (opcional)"
          className={inputClass}
        />
        {contact ? (
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Contacto activo
          </label>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Dialog>
  );
}
