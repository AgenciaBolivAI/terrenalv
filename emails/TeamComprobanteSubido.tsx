import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import EmailLayout, { styles } from './EmailLayout';

export interface TeamComprobanteSubidoProps {
  tracking_code?: string;
  manzana?: string;
  lote?: string;
  monto_bob?: number | string;
  posible_duplicado?: boolean;
  reviewUrl?: string | null;
}

export default function TeamComprobanteSubido({
  tracking_code = '—',
  manzana = '—',
  lote = '—',
  monto_bob,
  posible_duplicado = false,
  reviewUrl,
}: TeamComprobanteSubidoProps) {
  return (
    <EmailLayout preview={`Comprobante subido — ${tracking_code}`}>
      <Text style={styles.h1}>Comprobante subido</Text>
      <Text style={styles.text}>
        Hay un comprobante esperando verificación. Mientras se revisa, el plazo del comprador queda
        en pausa.
      </Text>
      <Section style={styles.infoBox}>
        <Text style={styles.label}>Código</Text>
        <Text style={styles.value}>{tracking_code}</Text>
        <Text style={styles.label}>Lote</Text>
        <Text style={styles.value}>
          Manzana {manzana} · Lote {lote}
        </Text>
        {monto_bob != null ? (
          <>
            <Text style={styles.label}>Monto esperado</Text>
            <Text style={{ ...styles.value, margin: 0 }}>Bs {monto_bob}</Text>
          </>
        ) : null}
      </Section>
      {posible_duplicado ? (
        <Section
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '10px',
            padding: '12px 14px',
            margin: '0 0 16px',
          }}
        >
          <Text style={{ color: '#b91c1c', fontSize: '13px', fontWeight: 700 as const, margin: 0 }}>
            Atención: la imagen coincide con otro comprobante ya registrado (posible duplicado).
          </Text>
        </Section>
      ) : null}
      {reviewUrl ? (
        <Button href={reviewUrl} style={styles.button}>
          Revisar ahora
        </Button>
      ) : null}
    </EmailLayout>
  );
}
