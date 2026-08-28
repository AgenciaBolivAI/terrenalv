import { Body, Button, Container, Head, Html, Preview, Section, Text } from '@react-email/components';

export interface BuyerVerificarCorreoProps {
  nombre?: string | null;
  enlace: string;
  baseUrl?: string | null;
}

/**
 * «Confirmá tu correo».
 *
 * La cuenta se crea sin pasar por el correo —el comprador entra en el acto—
 * así que esta es la única prueba de que la dirección existe. De eso dependen
 * el aviso de cuota y el saludo de cumpleaños: sin confirmar, se le escribe a
 * una casilla que quizá nadie lee.
 */
export default function BuyerVerificarCorreo({ nombre, enlace }: BuyerVerificarCorreoProps) {
  return (
    <Html lang="es">
      <Head />
      <Preview>Confirmá tu correo para recibir avisos de tu lote</Preview>
      <Body style={{ backgroundColor: '#faf8f4', fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <Container style={{ maxWidth: 520, margin: '0 auto', padding: '32px 24px' }}>
          <Text style={{ fontSize: 18, fontWeight: 700, color: '#1c1917', margin: '0 0 8px' }}>
            Confirmá tu correo
          </Text>
          <Text style={{ fontSize: 14, color: '#57534e', lineHeight: 1.6, margin: '0 0 20px' }}>
            {nombre ? `${nombre}, ` : ''}con tu correo confirmado te avisamos cuando vence tu cuota,
            te mandamos tus recibos y te saludamos en tu cumpleaños. Si no fuiste vos quien creó
            esta cuenta, ignorá este mensaje.
          </Text>
          <Section style={{ margin: '0 0 24px' }}>
            <Button
              href={enlace}
              style={{
                backgroundColor: '#14532d',
                color: '#ffffff',
                padding: '12px 22px',
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              Confirmar mi correo
            </Button>
          </Section>
          <Text style={{ fontSize: 12, color: '#a8a29e', lineHeight: 1.6, margin: 0 }}>
            El enlace vale por siete días. Si el botón no funciona, copiá esta dirección en tu
            navegador:
            <br />
            {enlace}
          </Text>
          <Text style={{ fontSize: 12, color: '#a8a29e', marginTop: 24 }}>
            Terrenalv S.R.L. — Santa Cruz, Bolivia
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
