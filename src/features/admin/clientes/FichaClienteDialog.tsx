'use client';

// El historial del cliente en una ventana, para las pantallas donde no
// conviene cambiar de modo (Planes, Traspasos): el nombre de una persona abre
// TODO lo suyo sin perder la lista donde se estaba.
//
// El contenido es el mismo componente que usa Ventas en su modo cliente: una
// sola verdad, dos envases. Si mañana el historial gana una sección, aparece
// en los dos lados sin tocar nada acá.

import Link from 'next/link';
import { Dialog } from '@/features/admin/ui/dialog';
import { btnPrimary } from '@/features/admin/ui/bits';
import { HistorialCliente } from './HistorialCliente';

export function FichaClienteDialog({
  ci,
  nombre,
  onClose,
  sinPlata = false,
}: {
  ci: string;
  nombre?: string;
  onClose: () => void;
  /** Cuentas abre la misma ficha, pero sin un solo importe. */
  sinPlata?: boolean;
}) {
  return (
    <Dialog open onClose={onClose} wide title={nombre ?? 'Cliente'}>
      <div className="max-h-[72vh] overflow-y-auto pr-1">
        <HistorialCliente ci={ci} sinPlata={sinPlata} />
      </div>
      {sinPlata ? null : (
        <div className="mt-4 flex justify-end border-t border-stone-100 pt-3">
          <Link href={`/admin/clientes?ci=${encodeURIComponent(ci)}`} className={btnPrimary}>
            Abrir en Carteras
          </Link>
        </div>
      )}
    </Dialog>
  );
}
