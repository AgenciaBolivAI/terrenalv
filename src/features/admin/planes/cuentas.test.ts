// Los números de estos tests no son inventados: son el plan LPV-DEMO2 de
// producción, el mismo que un día cobró Bs 1.000 de más porque el cronograma
// se armó sin restar la seña. Si alguien toca la cuenta y estos números dejan
// de salir, el test lo canta antes de que lo cante un comprador.

import { describe, expect, it } from 'vitest';
import { cuentaDelComprador, saldosCorridos, terminosDelPlan } from './cuentas';

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

describe('cuentaDelComprador', () => {
  // EDS-684B-B2SS, de producción. Lote Bs 24.800, entregó Bs 400 antes del
  // plan, así que se financian 24.400 al 1,67% mensual en 60 cuotas de
  // 646,99. Pagó 646 de la primera (le faltaron 0,99).
  const PAGOS = [
    { estado: 'aprobado', purpose: 'abono', amount_bob: 400 },
    { estado: 'aprobado', purpose: 'cuota', amount_bob: 646 },
  ];
  const PLAN = {
    estado: 'activo',
    cuotas: [
      { amount: 646.99, amount_paid: 646, status: 'parcial' },
      ...Array.from({ length: 58 }, () => ({
        amount: 646.99,
        amount_paid: 0,
        status: 'pendiente',
      })),
      { amount: 647.42, amount_paid: 0, status: 'pendiente' },
    ],
  };

  it('EDS-684B-B2SS: pagó lo que entregó, y la resta cierra', () => {
    const c = cuentaDelComprador(24800, PAGOS, PLAN);
    expect(c.entregado).toBe(1046); // 400 + 646, sin repartir en nada
    expect(c.teQueda).toBe(38173.83); // la misma cifra que ve el equipo en Planes
    expect(c.totalAPagar).toBe(39219.83);
    // Las dos comprobaciones que la hoja imprime:
    expect(c.totalAPagar - c.entregado).toBeCloseTo(c.teQueda, 2);
    expect(24800 + c.interes).toBeCloseTo(c.totalAPagar, 2);
    // Y el interés es el del cronograma sobre los 24.400 financiados.
    expect(c.interes).toBe(14419.83);
  });

  it('la comisión del mercado no es plata del comprador', () => {
    // Un lote recibido por traspaso arrastra la comisión que pagó el VENDEDOR.
    // Contarla le imprimía al comprador nuevo Bs 5.400 que nunca puso.
    const conComision = [
      { estado: 'aprobado', purpose: 'cuota', amount_bob: 7500 },
      { estado: 'aprobado', purpose: 'comision', amount_bob: 5400 },
    ];
    const c = cuentaDelComprador(30000, conComision, null);
    expect(c.entregado).toBe(7500);
    expect(c.teQueda).toBe(22500);
    expect(c.interes).toBe(0); // sin plan no hay interés que inventar
  });

  it('un plan cancelado no manda: se mide contra el precio', () => {
    // Sus cuotas quedan anuladas y la suma daría cero; la hoja llegaría a
    // decirle «¡Pagado!» a alguien que debe 20.000.
    const muerto = { estado: 'cancelado', cuotas: [] };
    const c = cuentaDelComprador(30000, [
      { estado: 'aprobado', purpose: 'cuota', amount_bob: 10000 },
    ], muerto);
    expect(c.teQueda).toBe(20000);
    expect(c.totalAPagar).toBe(30000);
  });

  it('los pagos que no entraron no cuentan', () => {
    const c = cuentaDelComprador(10000, [
      { estado: 'aprobado', purpose: 'reserva', amount_bob: 1000 },
      { estado: 'rechazado', purpose: 'cuota', amount_bob: 5000 },
      { estado: 'cancelado', purpose: 'cuota', amount_bob: 2000 },
    ], null);
    expect(c.entregado).toBe(1000);
    expect(c.teQueda).toBe(9000);
  });

  it('pagado de más no deja saldo negativo', () => {
    const c = cuentaDelComprador(10000, [
      { estado: 'aprobado', purpose: 'cuota', amount_bob: 12000 },
    ], null);
    expect(c.teQueda).toBe(0);
  });
});
