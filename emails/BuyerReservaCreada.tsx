import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import EmailLayout, { styles } from './EmailLayout';

export interface BuyerReservaCreadaProps {
  tracking_code?: string;
  manzana?: string;
  lote?: string;
  monto_bob?: number | string;
  reference_code?: string | null;
  vencimiento?: string | null; // formatted La_Paz datetime
  trackingUrl?: string | null;
  /** Public origin of the app, for the hosted logo in EmailLayout. */
  baseUrl?: string | null;
}

export default function BuyerReservaCreada({
  tracking_code = '—',
  manzana = '—',
  lote = '—',
  monto_bob,
  reference_code,
  vencimiento,
  trackingUrl,
  baseUrl,
}: BuyerReservaCreadaProps) {
  return (
    <EmailLayout baseUrl={baseUrl} preview={`Tu reserva ${tracking_code} está creada — paga la seña para asegurar tu lote`}>
      <Text style={styles.h1}>¡Tu reserva está creada!</Text>
      <Text style={styles.text}>
        Reservaste el <strong>Lote {lote}</strong> de la <strong>Manzana {manzana}</strong> en
        Estrellas del Sur. Guarda tu código de seguimiento:
      </Text>
      <Text style={styles.bigCode}>{tracking_code}</Text>
      <Section style={styles.infoBox}>
        {monto_bob != null ? (
          <>
            <Text style={styles.label}>Monto a transferir</Text>
            <Text style={styles.value}>Bs {monto_bob}</Text>
          </>
        ) : null}
        {reference_code ? (
          <>
            <Text style={styles.label}>Referencia para la glosa/concepto</Text>
            <Text style={{ ...styles.value, fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {reference_code}
            </Text>
          </>
        ) : null}
        {vencimiento ? (
          <>
            <Text style={styles.label}>Paga antes de</Text>
            <Text style={{ ...styles.value, margin: 0 }}>{vencimiento}</Text>
          </>
        ) : null}
      </Section>
      <Text style={styles.text}>
        Transfiere el monto exacto, escribe la referencia en la glosa y sube tu comprobante desde tu
        página de seguimiento.
      </Text>
      {trackingUrl ? (
        <Button href={trackingUrl} style={styles.button}>
          Ver mi reserva
        </Button>
      ) : null}
    </EmailLayout>
  );
}
