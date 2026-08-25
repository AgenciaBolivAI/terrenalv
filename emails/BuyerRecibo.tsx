import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import EmailLayout, { styles } from './EmailLayout';

export interface BuyerReciboProps {
  tracking_code?: string;
  /** Reserva | Venta | Comisión del mercado — el papel dice QUÉ se pagó. */
  tipo?: string;
  referencia?: string | null;
  monto?: number | null;
  moneda?: string | null;
  monto_bob?: number | null;
  manzana?: string | null;
  lote?: string | null;
  reciboUrl?: string | null;
  baseUrl?: string | null;
}

function money(n: number | null | undefined, cur: string | null | undefined): string {
  if (n == null) return '—';
  const s = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2 }).format(n);
  return cur === 'USD' ? `$us ${s}` : `Bs ${s}`;
}

export default function BuyerRecibo({
  tracking_code = '—',
  tipo = 'Venta',
  referencia,
  monto,
  moneda,
  monto_bob,
  manzana,
  lote,
  reciboUrl,
  baseUrl,
}: BuyerReciboProps) {
  return (
    <EmailLayout
      baseUrl={baseUrl}
      preview={`Tu recibo de ${tipo.toLowerCase()} — ${money(monto, moneda)}`}
    >
      <Text style={styles.h1}>Recibimos tu pago</Text>
      <Text style={styles.text}>
        Registramos tu pago de <strong>{money(monto, moneda)}</strong>
        {moneda === 'USD' && monto_bob != null ? <> (= {money(monto_bob, 'BOB')})</> : null} como{' '}
        <strong>{tipo}</strong>
        {manzana && lote ? (
          <>
            {' '}
            del Lote {lote}, Manzana {manzana}
          </>
        ) : null}
        . Tu recibo ya está listo.
      </Text>
      <Section style={styles.infoBox}>
        <Text style={styles.label}>Recibo</Text>
        <Text style={{ ...styles.value, margin: 0 }}>{referencia ?? tracking_code}</Text>
      </Section>
      {reciboUrl ? (
        <Button href={reciboUrl} style={styles.button}>
          Ver e imprimir mi recibo
        </Button>
      ) : null}
      <Text style={styles.text}>
        Puedes volver a abrirlo cuando quieras desde tu enlace de seguimiento. Este recibo no es
        una factura fiscal.
      </Text>
    </EmailLayout>
  );
}
