import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Estrellas del Sur — Terrenalv',
    short_name: 'Estrellas del Sur',
    description:
      'Mapa de lotes y reservas de la Urbanización Estrellas del Sur — Terrenalv S.R.L.',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf8f4',
    theme_color: '#14532d',
    lang: 'es',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
