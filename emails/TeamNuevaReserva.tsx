import { Button, Section, Text } from '@react-email/components';
import * as React from 'react';
import EmailLayout, { styles } from './EmailLayout';

export interface TeamNuevaReservaProps {
  tracking_code?: string;
  manzana?: string;
  lote?: string;
  monto_bob?: number | string;
  adminUrl?: string | null;
}

export default function TeamNuevaReserva({
  tracking_code = '—',
  manzana = '—',
  lote = '—',
  monto_bob,
  adminUrl,
}: TeamNuevaReservaProps) {
  return (
    <EmailLayout preview={`Nueva reserva ${tracking_code} — Lote ${lote}, Mz ${manzana}`}>
      <Text style={styles.h1}>Nueva reserva</Text>
      <Section style={styles.infoBox}>
        <Text style={styles.label}>Código</Text>
        <Text style={styles.value}>{tracking_code}</Text>
        <Text style={styles.label}>Lote</Text>
        <Text style={styles.value}>
          Manzana {manzana} · Lote {lote}
        </Text>
        {monto_bob != null ? (
          <>
            <Text style={styles.label}>Seña esperada</Text>
            <Text style={{ ...styles.value, margin: 0 }}>Bs {monto_bob}</Text>
          </>
        ) : null}
      </Section>
      <Text style={styles.text}>
        El comprador tiene un plazo limitado para transferir la seña y subir su comprobante.
      </Text>
      {adminUrl ? (
        <Button href={adminUrl} style={styles.button}>
          Ver en el panel
        </Button>
      ) : null}
    </EmailLayout>
  );
}
