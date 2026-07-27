import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import EmailLayout, { styles } from './EmailLayout';

export interface BuyerReservaConfirmadaProps {
  tracking_code?: string;
  manzana?: string | null;
  lote?: string | null;
  trackingUrl?: string | null;
  /** Public origin of the app, for the hosted logo in EmailLayout. */
  baseUrl?: string | null;
}

export default function BuyerReservaConfirmada({
  tracking_code = '—',
  manzana,
  lote,
  trackingUrl,
  baseUrl,
}: BuyerReservaConfirmadaProps) {
  return (
    <EmailLayout baseUrl={baseUrl} preview={`¡Pago confirmado! Tu reserva ${tracking_code} quedó asegurada`}>
      <Text style={styles.h1}>¡Pago confirmado!</Text>
      <Text style={styles.text}>
        Verificamos tu pago y tu reserva quedó <strong>confirmada</strong>.
        {manzana && lote ? (
          <>
            {' '}
            El <strong>Lote {lote}</strong> de la <strong>Manzana {manzana}</strong> ya es tuyo.
          </>
        ) : null}
      </Text>
      <Section style={styles.infoBox}>
        <Text style={styles.label}>Código de seguimiento</Text>
        <Text style={{ ...styles.value, margin: 0 }}>{tracking_code}</Text>
      </Section>
      <Text style={styles.text}>
        Nuestro equipo se pondrá en contacto contigo para coordinar la firma de documentos y los
        siguientes pasos.
      </Text>
      {trackingUrl ? (
        <Button href={trackingUrl} style={styles.button}>
          Ver mi reserva
        </Button>
      ) : null}
    </EmailLayout>
  );
}
