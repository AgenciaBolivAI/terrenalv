// Los números de estos tests no son inventados: son el plan LPV-DEMO2 de
// producción, el mismo que un día cobró Bs 1.000 de más porque el cronograma
// se armó sin restar la seña. Si alguien toca la cuenta y estos números dejan
// de salir, el test lo canta antes de que lo cante un comprador.

import { describe, expect, it } from 'vitest';
import { saldosCorridos, terminosDelPlan } from './cuentas';

const bs = (n: number) => `Bs ${n.toLocaleString('es-BO')}`;

describe('saldosCorridos', () => {
  it('LPV-DEMO2 reprogramado: arranca tras la pagada en 40.250 y muere en 0', () => {
    // 1 cuota pagada de 3.750 + 8 cuotas PAREJAS de 5.031,25 = Bs 44.000,
    // que es precio 50.000 − seña 1.000 − inicial 5.000. Parejas por regla
    // de la casa: 40.250 / 8 = 5.031,25 exacto.
    const cuotas = [
      { amount: 3750 },
      ...Array.from({ length: 8 }, () => ({ amount: 5031.25 })),
    ];
    const saldos = saldosCorridos(cuotas);
    expect(saldos[0]).toBe(40250); // el «te queda» del recibo tras la 1
    expect(saldos[saldos.length - 1]).toBe(0); // la última siempre salda
    expect(saldos).toHaveLength(9);
  });

  it('cada fila baja exactamente su cuota', () => {
    const saldos = saldosCorridos([{ amount: 100 }, { amount: 100 }, { amount: 50 }]);
    expect(saldos).toEqual([150, 50, 0]);
  });

  it('los centavos no se acumulan como error flotante', () => {
    // 3 × 33,33 + 0,01: la clase de suma que en coma flotante deja 0,0000001
    const saldos = saldosCorridos([
      { amount: 33.33 },
      { amount: 33.33 },
      { amount: 33.33 },
      { amount: 0.01 },
    ]);
    expect(saldos[3]).toBe(0);
    expect(saldos[2]).toBe(0.01);
  });

  it('acepta montos como texto, que es como llegan de la base', () => {
    expect(saldosCorridos([{ amount: '3750.00' }, { amount: '1250.00' }])).toEqual([1250, 0]);
  });

  it('sin cuotas no hay saldos', () => {
    expect(saldosCorridos([])).toEqual([]);
  });
});

describe('terminosDelPlan', () => {
  it('plan intacto: n cuotas de X', () => {
    expect(
      terminosDelPlan(
        { months: 12, monthly_amount: 4125, cuotas_totales: 12, cuotas_pagadas: 1 },
        bs,
      ),
    ).toBe('12 cuotas de Bs 4.125');
  });

  it('LPV-DEMO2 reprogramado: nombra el total y aclara qué falta', () => {
    // months = 8 (lo que se reprogramó), pero el comprador ve 9 filas: la
    // pagada más las ocho nuevas. Decir «8 cuotas» al lado de «llevás 1 de 9»
    // fue exactamente la incongruencia que salió en producción.
    expect(
      terminosDelPlan(
        { months: 8, monthly_amount: 5031.25, cuotas_totales: 9, cuotas_pagadas: 1 },
        bs,
      ),
    ).toBe('9 cuotas · las 8 que faltan son de Bs 5.031,25');
  });

  it('los montos llegan como texto desde la base y no rompe', () => {
    expect(
      terminosDelPlan(
        { months: 6, monthly_amount: '2625.00', cuotas_totales: 6, cuotas_pagadas: 0 },
        bs,
      ),
    ).toBe('6 cuotas de Bs 2.625');
  });
});
