import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import EmailLayout, { styles } from './EmailLayout';

const MOTIVO_COPY: Record<string, string> = {
  monto_incorrecto: 'El monto transferido no coincide con el monto de la seña.',
  comprobante_ilegible: 'La imagen del comprobante no se puede leer con claridad.',
  pago_no_encontrado: 'No encontramos la transferencia en nuestra cuenta.',
  comprobante_duplicado: 'El comprobante ya fue usado en otra reserva.',
  otro: 'Hubo un problema con tu comprobante.',
};

export interface BuyerComprobanteRechazadoProps {
  tracking_code?: string;
  motivo?: string | null;
  permite_reintento?: boolean;
  trackingUrl?: string | null;
}

export default function BuyerComprobanteRechazado({
  tracking_code = '—',
  motivo,
  permite_reintento = true,
  trackingUrl,
}: BuyerComprobanteRechazadoProps) {
  const motivoTexto = (motivo && MOTIVO_COPY[motivo]) || MOTIVO_COPY.otro;
  return (
    <EmailLayout preview={`Revisa tu comprobante — reserva ${tracking_code}`}>
      <Text style={styles.h1}>Revisa tu comprobante</Text>
      <Text style={styles.text}>
        Revisamos el comprobante de tu reserva <strong>{tracking_code}</strong> y no pudimos
        aprobarlo.
      </Text>
      <Section
        style={{
          backgroundColor: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '10px',
          padding: '12px 14px',
          margin: '0 0 16px',
        }}
      >
        <Text style={{ color: '#92400e', fontSize: '13px', margin: 0 }}>{motivoTexto}</Text>
      </Section>
      {permite_reintento ? (
        <Text style={styles.text}>
          Puedes subir un nuevo comprobante desde tu página de seguimiento. Tu lote sigue reservado
          por un plazo limitado.
        </Text>
      ) : (
        <Text style={styles.text}>
          La reserva fue cancelada. Si crees que es un error, contáctanos por WhatsApp y te
          ayudaremos.
        </Text>
      )}
      {trackingUrl ? (
        <Button href={trackingUrl} style={styles.button}>
          {permite_reintento ? 'Subir nuevo comprobante' : 'Ver mi reserva'}
        </Button>
      ) : null}
    </EmailLayout>
  );
}
