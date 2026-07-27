import { Button, Text } from '@react-email/components';
import * as React from 'react';
import EmailLayout, { styles } from './EmailLayout';

export interface BuyerReservaExpiradaProps {
  tracking_code?: string;
  trackingUrl?: string | null;
}

export default function BuyerReservaExpirada({
  tracking_code = '—',
  trackingUrl,
}: BuyerReservaExpiradaProps) {
  return (
    <EmailLayout preview={`Tu reserva ${tracking_code} expiró`}>
      <Text style={styles.h1}>Tu reserva expiró</Text>
      <Text style={styles.text}>
        El plazo de pago de tu reserva <strong>{tracking_code}</strong> terminó y el lote volvió a
        estar disponible para otras personas.
      </Text>
      <Text style={styles.text}>
        ¿Ya hiciste la transferencia? Escríbenos por WhatsApp: si el pago llegó, es posible que
        podamos reactivar tu reserva.
      </Text>
      <Text style={styles.text}>
        Si todavía te interesa un lote en Estrellas del Sur, puedes volver a reservar desde el mapa.
      </Text>
      {trackingUrl ? (
        <Button href={trackingUrl} style={styles.button}>
          Ver detalle
        </Button>
      ) : null}
    </EmailLayout>
  );
}
