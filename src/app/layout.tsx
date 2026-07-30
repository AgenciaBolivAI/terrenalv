import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Prados del Sur — Terrenalv S.R.L.',
    template: '%s — Terrenalv',
  },
  description:
    'Urbanización Prados del Sur: 88 manzanas con lotes de 300 m² sobre la carretera Santa Cruz — Camiri, Zanja Honda, Cabezas, Santa Cruz. Reserva tu lote en línea con Terrenalv S.R.L.',
};

export const viewport: Viewport = {
  themeColor: '#14532d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
