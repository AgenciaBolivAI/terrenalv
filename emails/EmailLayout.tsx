import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';

export const BRAND_GREEN = '#14532d';
export const BRAND_GREEN_LIGHT = '#16a34a';

export const styles = {
  h1: {
    color: '#1c1917',
    fontSize: '20px',
    fontWeight: 700 as const,
    margin: '0 0 12px',
  },
  text: {
    color: '#44403c',
    fontSize: '14px',
    lineHeight: '22px',
    margin: '0 0 12px',
  },
  small: {
    color: '#a8a29e',
    fontSize: '12px',
    lineHeight: '18px',
    margin: '0',
  },
  label: {
    color: '#78716c',
    fontSize: '12px',
    margin: '0',
  },
  value: {
    color: '#1c1917',
    fontSize: '14px',
    fontWeight: 600 as const,
    margin: '0 0 10px',
  },
  bigCode: {
    color: BRAND_GREEN,
    fontSize: '24px',
    fontWeight: 800 as const,
    letterSpacing: '1px',
    fontFamily: 'ui-monospace, Menlo, monospace',
    margin: '0 0 12px',
  },
  button: {
    backgroundColor: BRAND_GREEN,
    borderRadius: '10px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: 700 as const,
    padding: '12px 22px',
    textDecoration: 'none',
  },
  infoBox: {
    backgroundColor: '#f5f5f4',
    borderRadius: '10px',
    padding: '14px 16px',
    margin: '0 0 16px',
  },
};

export default function EmailLayout({
  preview,
  children,
}: {
  preview: string;
  children: React.ReactNode;
}) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: '#faf8f4', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: '480px', margin: '0 auto', padding: '24px 16px' }}>
          <Section style={{ textAlign: 'center' as const, paddingBottom: '16px' }}>
            <Text
              style={{
                color: BRAND_GREEN,
                fontSize: '18px',
                fontWeight: 900 as const,
                letterSpacing: '4px',
                margin: 0,
              }}
            >
              TERRENALV
            </Text>
            <Text style={{ color: '#78716c', fontSize: '12px', margin: '2px 0 0' }}>
              Urbanización Estrellas del Sur
            </Text>
          </Section>
          <Section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e7e5e4',
              padding: '24px',
            }}
          >
            {children}
          </Section>
          <Hr style={{ borderColor: '#e7e5e4', margin: '20px 0 12px' }} />
          <Text style={{ ...styles.small, textAlign: 'center' as const }}>
            Terrenalv S.R.L. — Zanja Honda, Cabezas, Santa Cruz, Bolivia.
            <br />
            Este es un mensaje automático; no respondas a este correo.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
