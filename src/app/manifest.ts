import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Prados del Sur — Terrenalv',
    short_name: 'Prados del Sur',
    description:
      'Mapa de lotes y reservas de la Urbanización Prados del Sur — Terrenalv S.R.L.',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf8f4',
    theme_color: '#14532d',
    lang: 'es',
    icons: [
      // Served by Next from src/app/icon.png (512) and apple-icon.png (180),
      // both generated from the brand's logo.jpg.
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
