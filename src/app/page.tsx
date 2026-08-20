import Link from 'next/link';
import { waLink, formatMoney } from '@/lib/format';
import { Logo } from '@/components/Logo';
import { ActiveReservationBanner } from '@/features/reservations/components/ActiveReservationBanner';
import { MiReservaLink } from '@/features/reservations/components/MiReservaLink';
import { loadLandingData } from '@/features/landing/data';
import { Pasarella, type Slide } from '@/features/landing/Pasarella';
import { loadInstagramPosts } from '@/features/landing/instagram';
import { InstagramFeed, type FallbackPost } from '@/features/landing/InstagramFeed';

// The company's own marketing flyers, in pasarella/. Alt text describes what
// each one actually says — these are the source for the claims on this page
// (club house, servicios, Derechos Reales), none of which I invented.
const FLYER = { width: 900, height: 1125 };
// Architectural renders of the club house, supplied by Terrenalv. Every one is
// badged "Render del proyecto" on the slide: they show what is being built, and
// a buyer must not mistake them for a photo of something already finished.
const RENDER = { width: 1280, height: 720, badge: 'Render del proyecto' };

const PASARELLA: Slide[] = [
  // 01-precio.jpg está fuera hasta que llegue un folleto nuevo: la imagen dice
  // "desde Bs 24.800" impreso, y el precio de contado ahora arranca en Bs 29.999.
  // No se puede editar una foto desde acá, y dejarla puesta era publicar un
  // precio viejo al lado del nuevo en la misma pantalla.
  { ...FLYER, src: '/pasarella/02-comparativa.jpg', alt: 'Prados del Sur frente a otros proyectos: servicios básicos, sobre la avenida internacional, papeles al día y club house incluido.' },
  { ...FLYER, src: '/pasarella/03-alquiler.jpg', alt: 'Cada mes pagás alquiler por algo que nunca va a ser tuyo, o pagás cuotas por tu propio terreno. Servicios básicos, papeles al día, sin banco.' },
  { ...FLYER, src: '/pasarella/04-plusvalia.jpg', alt: 'Invertir en un terreno propio con plusvalía real: sobre la avenida internacional, zona de alto crecimiento, cuotas accesibles y club house incluido.' },
  { ...FLYER, src: '/pasarella/05-trayectoria.jpg', alt: '7 años entregando terrenos con todo en orden: papeles registrados en Derechos Reales, servicios básicos instalados y crédito directo sin banco.' },
  { ...FLYER, src: '/pasarella/06-avance.jpg', alt: 'Un asesor de Terrenalv frente a los lotes ya abiertos: 60% de los terrenos vendidos, papeles al día, cuotas accesibles, sin bancos.' },
  { ...FLYER, src: '/pasarella/07-testimonio.jpg', alt: 'Testimonio de un cliente: compró 15 terrenos buscando una inversión segura y rentable para su familia.' },

  // Club house, en el orden en que uno lo recorre: la piscina, los bares, y
  // después el edificio con su churrasquería y el parque infantil.
  { ...RENDER, src: '/clubhouse/ch-08.jpg', alt: 'Render de la piscina del club house de Prados del Sur, con el muro de piedra que lleva el nombre del proyecto, un bar bajo techo de teja, sombrillas, tumbonas y un tobogán para los chicos.' },
  { ...RENDER, src: '/clubhouse/ch-07.jpg', alt: 'Render de la piscina vista desde el agua: el bar techado sobre la piscina, reposeras dentro del agua y el muro de piedra con el nombre Prados del Sur.' },
  { ...RENDER, src: '/clubhouse/ch-10.jpg', alt: 'Render de la piscina completa vista desde el césped, con la terraza de mesas y sombrillas a un costado.' },
  { ...RENDER, src: '/clubhouse/ch-02.jpg', alt: 'Render del bar dentro de la piscina, con banquetas sumergidas y barra de madera bajo un techo de teja.' },
  { ...RENDER, src: '/clubhouse/ch-04.jpg', alt: 'Render del bar de la piscina y su muro de agua, con mesas a la sombra y la barra con banquetas altas.' },
  { ...RENDER, src: '/clubhouse/ch-09.jpg', alt: 'Render de la terraza junto a la piscina: mesas con sombrillas, deck de madera, palmeras y el tobogán al fondo.' },
  { ...RENDER, src: '/clubhouse/ch-05.jpg', alt: 'Render del club house visto de frente, con su techo de teja, el ingreso entre columnas verdes y el parque infantil al costado.' },
  { ...RENDER, src: '/clubhouse/ch-06.jpg', alt: 'Render del ingreso al club house entre las columnas verdes, con el salón techado y la churrasquería al fondo.' },
  { ...RENDER, src: '/clubhouse/ch-01.jpg', alt: 'Render del salón techado del club house con mesas, y el parque infantil sobre el césped al lado.' },
  { ...RENDER, src: '/clubhouse/ch-03.jpg', alt: 'Render del interior del salón del club house: barra, mesas para las familias y vista abierta al parque.' },
];

const WHATSAPP_VENTAS = '+59175511996'; // Ventas Terrenalv

// Real accounts, verified against the live profiles (names + Prados del Sur
// content). Do NOT add links that have not been checked.
const SOCIAL = {
  facebook: 'https://www.facebook.com/Terrenalv/',
  tiktok: 'https://www.tiktok.com/@terrenalv.s.r.l',
  tiktokUser: 'terrenalv.s.r.l',
  instagram: 'https://www.instagram.com/terrenalv_srl/',
};

// Featured videos, each verified via TikTok's public oEmbed as published by
// @terrenalv.s.r.l. Chosen for the buyer's journey: who Terrenalv is, the
// Prados del Sur lots themselves, and the "is this a scam?" doubt answered.
const FEATURED_TIKTOKS: { id: string; caption: string }[] = [
  { id: '7590183493653515576', caption: 'Quiénes somos: el sueño detrás de Terrenalv' },
  { id: '7667981112022502676', caption: 'Nuevos lotes habilitados en Prados del Sur' },
  { id: '7668375936672320789', caption: 'Estos precios no vuelven' },
  { id: '7668557245537438997', caption: 'Tu miniquinta, para disfrutar o invertir' },
  { id: '7668793237041057045', caption: '¿Dudas? Visítanos en oficina antes de invertir' },
  { id: '7670249275229605141', caption: '¿Te imaginas pagar por algo que sí es tuyo?' },
];

// Shown ONLY while the live Instagram feed is unavailable — before the token is
// connected, or if Meta is down. Each shortcode was read off the live profile
// and confirmed to render at /reel/<code>/embed/ without a login wall.
const INSTAGRAM_FALLBACK: FallbackPost[] = [
  { code: 'DZdisGSAa7R', caption: '¿Ya tenés tu terreno propio?' },
  { code: 'DZn145UgWL5', caption: 'Cuánto cuesta un terreno en Prados del Sur' },
  { code: 'DZmm25wDKWt', caption: 'La zona, los servicios y lo que ya está hecho' },
];

// The pin the owner identified on Google Maps (plus code beside Zanja Honda).
const MAPS_EMBED =
  'https://maps.google.com/maps?q=PRH3%2BWJ7%20Zanja%20Honda%2C%20Cabezas%2C%20Santa%20Cruz%2C%20Bolivia&z=13&output=embed';

// Live figures re-checked every 5 minutes; the page still renders with the
// database down (every number below is optional).
export const revalidate = 300;

// Todo el contenido del proyecto sale del plano CAD y de la maqueta. No
// inventar amenidades ni cifras: si no está en el plano o en la base de datos,
// no va en la página.
// Labels are column HEADINGS, not tails: they sit above the figure in the
// schedule, so "de áreas verdes" would read as "DE ÁREAS VERDES / 4,8 ha".
function numeros(totalLotes: number | null): [string, string][] {
  return [
    ['88', 'Manzanas'],
    [totalLotes ? totalLotes.toLocaleString('es-BO') : '2.078', 'Lotes en el plano'],
    ['300 m²', 'Lote típico (10 × 30)'],
    ['4,8 ha', 'Áreas verdes'],
    ['5,6 ha', 'Equipamiento'],
    ['3,2 km', 'Frente sobre la vía'],
  ];
}

const PASOS: [string, string, string][] = [
  ['1', 'Explora el mapa', 'Verde = disponible. Toca un lote para ver medidas y precio reales del plano.'],
  ['2', 'Reserva con tus datos', 'Nombre, carnet y celular. Sin crear cuenta y sin pagar nada todavía.'],
  ['3', 'Paga la seña con QR', 'Transfiere desde tu banco y sube la foto del comprobante. Tienes 48 horas.'],
  ['4', 'Lote asegurado', 'El equipo verifica tu pago, el lote queda a tu nombre y firmas el contrato en oficina.'],
];

const FAQ: [string, string][] = [
  [
    '¿Puedo elegir exactamente qué lote quiero?',
    'Sí. El mapa muestra los lotes del plano oficial con su número, medidas y precio reales. El que reservas es exactamente ese lote, no "uno parecido".',
  ],
  [
    '¿Cuánto tiempo tengo para pagar la seña?',
    '48 horas desde que haces la reserva. Durante ese tiempo el lote queda bloqueado para ti y nadie más puede tomarlo. Si no llega el pago, vuelve a estar disponible.',
  ],
  [
    '¿La seña es reembolsable?',
    'La seña se aplica íntegramente al precio del lote. No es reembolsable, salvo que tu comprobante sea rechazado y no sea posible completar la verificación.',
  ],
  [
    '¿Qué necesito para reservar?',
    'Solo tu carnet de identidad y un celular con WhatsApp. La reserva es 100% en línea; el contrato de compraventa se firma después en oficina.',
  ],
  [
    '¿Cómo sé que un lote sigue disponible?',
    'El mapa se actualiza en tiempo real: cuando alguien reserva, el lote cambia de color al instante para todos los visitantes.',
  ],
  [
    '¿Dónde queda exactamente el proyecto?',
    'En la zona de Zanja Honda, municipio de Cabezas, provincia Cordillera (Santa Cruz), con frente sobre la carretera internacional Argentina — Paraguay (ruta Santa Cruz — Camiri). Abajo está el punto en el mapa.',
  ],
];

function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.24-.86.84-.86 2.05s.88 2.38 1 2.54c.13.17 1.73 2.65 4.2 3.72.59.25 1.04.4 1.4.52.59.18 1.12.16 1.55.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z" />
    </svg>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur-xs">
      {children}
    </span>
  );
}

/**
 * Section opener in the language of the plano: a monospaced annotation over a
 * hairline, then the heading. The annotation names which part of the project
 * the section covers — the way a drawing's title block does — so it carries
 * information instead of decorating the heading.
 */
function SectionHead({
  annot,
  title,
  lede,
  align = 'center',
}: {
  annot: string;
  title: string;
  lede?: string;
  align?: 'center' | 'left';
}) {
  const centered = align === 'center';
  return (
    <div className={centered ? 'text-center' : undefined}>
      <div className={`flex items-center gap-3 ${centered ? 'justify-center' : ''}`}>
        <span aria-hidden="true" className="h-px w-8 bg-earth/45" />
        <p className="annot text-earth">{annot}</p>
        {centered ? <span aria-hidden="true" className="h-px w-8 bg-earth/45" /> : null}
      </div>
      <h2 className="mt-3 text-balance text-3xl font-black tracking-tight text-brand sm:text-4xl">
        {title}
      </h2>
      {lede ? (
        <p className={`mt-3 text-lg text-stone-600 ${centered ? 'mx-auto max-w-2xl' : 'max-w-xl'}`}>
          {lede}
        </p>
      ) : null}
    </div>
  );
}

export default async function Home() {
  // Independent sources: a slow or missing Instagram feed must not hold up the
  // live figures, and neither one failing can take the other down.
  const [live, instagram] = await Promise.all([loadLandingData(), loadInstagramPosts(3)]);
  const cur = live.currency;

  return (
    <div className="min-h-screen flex flex-col pb-20 sm:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-brand/95 text-white backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" aria-label="Inicio">
            <Logo variant="inverse" className="h-7 w-auto" />
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/prados-del-sur/mapa"
              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20"
            >
              Ver mapa
            </Link>
            <MiReservaLink className="hidden rounded-full px-4 py-2 text-sm font-semibold transition hover:bg-white/10 sm:block">
              Mi reserva
            </MiReservaLink>
          </nav>
        </div>
      </header>

      {/* Hero — the real aerial of the land behind it: the road, the opened
          streets and the lots already staked out. Choosing a lot is the first
          thing the page asks for. */}
      <section className="relative isolate text-white">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-brand bg-cover bg-center"
          style={{ backgroundImage: "url('/aerea-lotes.jpg')" }}
        />
        {/* Keeps the white text readable over a bright, sunlit photo. */}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-b from-brand/85 via-brand/80 to-emerald-950/90" />
        {/* The surveyor's grid, laid over the land it measures. */}
        <div aria-hidden="true" className="plot-grid absolute inset-0 -z-10" />
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:py-28">
          <p className="annot text-earth-tan">
            Urbanización Ciudadela · Zanja Honda, Santa Cruz
          </p>
          <h1 className="mt-4 text-5xl font-black tracking-tighter sm:text-7xl lg:text-8xl">
            Prados del Sur
          </h1>
          {/* Slogan oficial de Terrenalv S.R.L. */}
          <p className="mt-4 text-lg font-bold italic text-earth-tan sm:text-xl">
            «Lo que se dice, se cumple»/<br/>
            El cliente propone su forma de pago<br/>
            By Terreenalv S.R.L.
          </p>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-emerald-50/90">
            Proyectos urbanisticos en la zona sur de Santa Cruz, carretera internacional Argentina— Paraguay.
            El mapa muestra el plano oficial lote por lote: elige el tuyo y resérvalo en minutos
            desde el celular.
          </p>

          {/* Live availability — hidden entirely if the DB is unreachable. */}
          {(live.disponibles ?? 0) > 0 ? (
            <div className="mt-7 flex flex-wrap justify-center gap-2">
              <Chip>
                <span className="figures text-earth-tan">
                  {live.disponibles!.toLocaleString('es-BO')}
                </span>{' '}
                lotes disponibles hoy
              </Chip>
              {live.desde !== null ? (
                <Chip>
                  desde{' '}
                  <span className="figures text-earth-tan">{formatMoney(live.desde, cur)}</span>
                </Chip>
              ) : null}
              {live.financing ? (
                <Chip>
                  cuotas desde{' '}
                  <span className="figures text-earth-tan">
                    {formatMoney(
                      live.financing.monthly,
                      live.financing.minMonthly !== null
                        ? live.financing.downPaymentCurrency
                        : cur,
                    )}
                    /mes
                  </span>
                </Chip>
              ) : null}
            </div>
          ) : null}

          {/* Choosing the lot is THE action; WhatsApp sits beside it, not above. */}
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/prados-del-sur/mapa"
              className="rounded-2xl bg-earth px-9 py-5 text-xl font-black text-white shadow-[0_12px_32px_-10px_rgba(0,0,0,.6)] ring-1 ring-white/15 transition hover:bg-earth-light"
            >
              Elegir mi lote en el mapa
            </Link>
            <a
              href={waLink(WHATSAPP_VENTAS, 'Hola Terrenalv, quiero información sobre los lotes de Prados del Sur.')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-8 py-5 text-lg font-semibold backdrop-blur-xs transition hover:bg-white/20"
            >
              <WhatsappIcon className="h-5 w-5" />
              Hablar por WhatsApp
            </a>
          </div>
          <p className="mt-5 text-sm text-white/70">
            Ves cada lote del plano con su número, medidas y precio. Sin cuenta, sin costo.
          </p>
          <div className="mx-auto mt-6 max-w-md text-stone-900">
            <ActiveReservationBanner />
          </div>
        </div>
      </section>

      {/* El proyecto en números — straight off the CAD plano */}
      <section className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12">
          {/* Read as a survey schedule: hairline-ruled cells, figures in a
              tabular face so the columns line up down the grid. */}
          <dl className="grid grid-cols-2 border-t border-l border-stone-200 sm:grid-cols-3 lg:grid-cols-6">
            {numeros(live.totalLotes).map(([n, label]) => (
              <div key={label} className="border-r border-b border-stone-200 px-4 py-5">
                <dt className="annot text-stone-400">{label}</dt>
                <dd className="figures mt-2 text-3xl font-black text-brand">{n}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-center text-xs text-stone-400">
            Cifras del plano oficial de la urbanización (levantamiento CAD, mayo 2025).
          </p>
        </div>
      </section>

      {/* Qué incluye — cada punto sale de los materiales de Terrenalv
          (folletos de pasarella/ y sus videos), no de suposiciones mías. */}
      <section className="bg-earth-pale border-b border-stone-200">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <SectionHead annot="Lo que compras" title="Qué incluye tu terreno" />

          <div className="mt-10 grid items-start gap-6 lg:grid-cols-3">
            {/* Club house: the headline amenity in their own material. */}
            <div className="relative isolate overflow-hidden rounded-3xl bg-earth p-8 text-white shadow-[0_18px_44px_-20px_rgba(124,79,44,.85)] lg:col-span-1">
              <div aria-hidden="true" className="plot-grid absolute inset-0 -z-10" />
              <p className="annot text-earth-tan">Incluido</p>
              <h3 className="mt-3 text-3xl font-black tracking-tight">Club House</h3>
              <p className="mt-3 text-white/90">
                La ciudadela tiene su propio club house con áreas sociales para las familias de
                Prados del Sur — ya hay lotes habilitados a pasos de él.
              </p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              {(
                [
                  ['Servicios básicos incluidos', 'Instalados en la urbanización, no prometidos para después.'],
                  ['Papeles al día', 'Registrados en Derechos Reales, todo en orden desde el primer día.'],
                  ['Crédito directo, sin banco', 'Financiamiento propio a sola firma: sin trámites bancarios ni garantes.'],
                  ['A 35 min del km 13 de la doble vía La Guardia', 'Sobre la avenida internacional, cerca de colegio, centro médico y mercado.'],
                ] as [string, string][]
              ).map(([t, b]) => (
                <li key={t} className="card card-lift rounded-3xl bg-white p-6">
                  <p className="text-balance font-bold text-brand">{t}</p>
                  <p className="mt-2 text-sm text-stone-600">{b}</p>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-8 text-center text-sm text-stone-500">
            7 años entregando terrenos con todo en orden.
          </p>
        </div>
      </section>

      {/* Pasarella de fotos — antes de los videos */}
      <section className="bg-stone-50 border-b border-stone-200">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <SectionHead
            annot="Registro fotográfico"
            title="El proyecto, en imágenes"
            lede="Terrenos, servicios y avances, más los renders del club house tal como se está construyendo."
          />
          <div className="mt-10">
            <Pasarella slides={PASARELLA} />
          </div>
        </div>
      </section>

      {/* Videos reales desde redes sociales */}
      <section className="bg-stone-100">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <SectionHead
            annot="TikTok · Instagram · Facebook"
            title="Mira el proyecto en video"
            lede="Avances de obra, recorridos y entregas de terrenos, publicados por el propio equipo de Terrenalv."
          />

          <div className="mt-10 flex items-center gap-3">
            <p className="annot shrink-0 text-earth">TikTok · @{SOCIAL.tiktokUser}</p>
            <span aria-hidden="true" className="h-px flex-1 bg-stone-300" />
            <a
              href={SOCIAL.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-sm font-semibold text-brand hover:underline"
            >
              Ver perfil →
            </a>
          </div>

          {/* Featured videos — fixed, verified posts so the section has real
              content immediately, before the Facebook plugin hydrates. */}
          <div className="mt-5 grid gap-6 sm:grid-cols-3">
            {FEATURED_TIKTOKS.map((v) => (
              <figure key={v.id} className="card card-lift rounded-3xl bg-white p-3">
                <div className="overflow-hidden rounded-2xl bg-stone-900">
                  <iframe
                    title={v.caption}
                    src={`https://www.tiktok.com/embed/v2/${v.id}`}
                    className="w-full border-0"
                    style={{ height: 580 }}
                    loading="lazy"
                    allow="encrypted-media; picture-in-picture; fullscreen"
                  />
                </div>
                <figcaption className="mt-2 px-1 text-sm font-semibold text-stone-700">
                  {v.caption}
                </figcaption>
              </figure>
            ))}
          </div>

          {/* Instagram */}
          <div className="mt-14">
            <div className="flex items-center gap-3">
              <p className="annot shrink-0 text-earth">Instagram · @terrenalv_srl</p>
              <span aria-hidden="true" className="h-px flex-1 bg-stone-300" />
              <a
                href={SOCIAL.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm font-semibold text-brand hover:underline"
              >
                Ver perfil →
              </a>
            </div>
            <InstagramFeed posts={instagram} fallback={INSTAGRAM_FALLBACK} />
          </div>

          {/* Facebook. A TikTok card used to sit beside it, but the embeds above
              are already TikTok and the follow buttons below already link to the
              profile — it was the same link said three times, in an empty box. */}
          <div className="mx-auto mt-14 max-w-2xl">
            {/* Facebook: page timeline plugin — latest posts and videos. */}
            <div className="flex items-center gap-3">
              <p className="annot shrink-0 text-earth">Facebook · Terrenalv.srl</p>
              <span aria-hidden="true" className="h-px flex-1 bg-stone-300" />
              <a
                href={SOCIAL.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm font-semibold text-brand hover:underline"
              >
                Ver página →
              </a>
            </div>
            <div className="card mt-5 rounded-3xl bg-white p-4">
              <div className="overflow-hidden rounded-2xl">
                <iframe
                  title="Página de Facebook de Terrenalv"
                  src={`https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(SOCIAL.facebook)}&tabs=timeline&width=500&height=560&small_header=true&adapt_container_width=true&hide_cover=false&show_facepile=false`}
                  width="500"
                  height="560"
                  className="w-full max-w-125 mx-auto block border-0"
                  style={{ border: 'none', overflow: 'hidden' }}
                  scrolling="no"
                  frameBorder="0"
                  allowFullScreen
                  loading="lazy"
                  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {[
              ['TikTok', SOCIAL.tiktok],
              ['Facebook', SOCIAL.facebook],
              ['Instagram', SOCIAL.instagram],
            ].map(([name, url]) => (
              <a
                key={name}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-brand/30 bg-white px-5 py-2.5 text-sm font-bold text-brand hover:bg-brand/5"
              >
                Síguenos en {name}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Plan de pago — live desde la base de datos */}
      <section className="bg-white border-y border-stone-200">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <SectionHead annot="Plan de pago" title="¿Cuánto necesito para empezar?" />

          {/* Three moments in order: hoy, al arrancar, cada mes. The sequence is
              the point, so the cards read left to right as a timeline. */}
          <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-3">
            <div className="card rounded-3xl border-earth-tan! bg-earth-pale p-7 text-center">
              <p className="annot text-earth">Hoy, para asegurar tu lote</p>
              <p className="figures mt-3 text-3xl font-black text-stone-900">
                {live.sena ? formatMoney(live.sena.amount, live.sena.currency) : 'Una seña'}
              </p>
              <p className="mt-3 text-sm text-stone-600">
                Se paga por QR al reservar y se descuenta íntegra del precio del lote.
              </p>
            </div>
            <div className="card rounded-3xl bg-white p-7 text-center">
              <p className="annot text-stone-400">Cuota inicial</p>
              {/* A fixed cuota inicial is quoted in bolivianos even though the
                  lot is priced in dólares — show it in its own currency. */}
              <p className="figures mt-3 text-3xl font-black text-stone-900">
                {live.financing
                  ? formatMoney(live.financing.downPayment, live.financing.downPaymentCurrency)
                  : '—'}
              </p>
              <p className="mt-3 text-sm text-stone-600">
                {live.financing && live.tipico
                  ? `Con eso arrancas, sea cual sea el lote. Un lote típico cuesta ${formatMoney(live.tipico, cur)}.`
                  : 'Se confirma con tu asesor al reservar.'}
              </p>
            </div>
            <div className="card rounded-3xl bg-white p-7 text-center">
              <p className="annot text-stone-400">Cuota mensual</p>
              {/* Only the minimum is published. The term depends on conditions
                  Terrenalv agrees in person, so no "N cuotas" here. */}
              <p className="mt-3 text-3xl font-black text-stone-900">
                {live.financing ? (
                  <>
                    <span className="text-xl font-bold text-stone-500">desde </span>
                    <span className="figures">
                      {formatMoney(
                        live.financing.monthly,
                        live.financing.minMonthly !== null
                          ? live.financing.downPaymentCurrency
                          : cur,
                      )}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </p>
              <p className="mt-3 text-sm text-stone-600">
                Crédito directo, sin banco y a sola firma. El plazo lo armas con tu asesor.
              </p>
            </div>
          </div>

          {/* Slogan-backed differentiator: en Terrenalv el cliente propone su
              forma de pago — the plan above is a reference, not a cage. */}
          <div className="relative isolate mx-auto mt-8 max-w-3xl overflow-hidden rounded-3xl bg-earth p-8 text-center text-white shadow-[0_18px_44px_-20px_rgba(124,79,44,.85)] sm:p-10">
            <div aria-hidden="true" className="plot-grid absolute inset-0 -z-10" />
            <p className="text-2xl font-black tracking-tight sm:text-3xl">
              Tú propones tu forma de pago
            </p>
            <p className="mt-3 text-white/85">
              El plan de arriba es referencial. En Terrenalv <strong>el cliente propone su forma
              de pago</strong>: cuéntanos cuánto puedes dar de inicial y cuánto por mes, y lo
              armamos contigo.
            </p>
            <a
              href={waLink(WHATSAPP_VENTAS, 'Hola Terrenalv, quiero proponer mi forma de pago para un lote de Prados del Sur.')}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white text-earth font-bold px-7 py-3.5 hover:bg-earth-pale transition"
            >
              <WhatsappIcon className="h-5 w-5" />
              Proponer mi forma de pago por WhatsApp
            </a>
          </div>

          <p className="mt-6 text-center text-xs text-stone-400 max-w-xl mx-auto">
            Cifras de referencia. El plan definitivo de cada lote se acuerda con tu asesor y se
            firma en oficina.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-stone-50">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <SectionHead annot="Cuatro pasos" title="¿Cómo reservo mi lote?" />
          {/* The numbers are real here — this is an ordered process with a
              48-hour clock in it, so the sequence is information, not decor.
              A hairline runs behind the markers to show it as one run. */}
          <ol className="relative mt-10 grid gap-8 sm:grid-cols-4">
            <span
              aria-hidden="true"
              className="absolute inset-x-[12.5%] top-6 hidden h-px bg-stone-300 sm:block"
            />
            {PASOS.map(([n, title, body]) => (
              <li key={n} className="relative text-center">
                <div className="figures mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand text-xl font-black text-white ring-4 ring-stone-50">
                  {n}
                </div>
                <p className="mt-4 font-bold text-brand">{title}</p>
                <p className="mt-1.5 text-sm text-stone-600">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-10 text-center">
            <Link
              href="/prados-del-sur/mapa"
              className="inline-block rounded-2xl bg-brand px-8 py-4 font-bold text-white shadow-[0_10px_28px_-12px_rgba(20,83,45,.8)] transition hover:bg-emerald-800"
            >
              Ver lotes disponibles
            </Link>
          </p>
        </div>
      </section>

      {/* Ubicación */}
      <section className="bg-white border-y border-stone-200">
        <div className="mx-auto max-w-6xl px-4 py-14 grid gap-8 lg:grid-cols-2 items-center">
          <div>
            <SectionHead annot="Ubicación" title="¿Dónde queda?" align="left" />
            {/* Each line is a fact off the plano, so they read as a schedule of
                data rather than a bulleted list. */}
            <dl className="mt-6 divide-y divide-stone-200 border-y border-stone-200">
              {(
                [
                  ['Zona', <>Zanja Honda, municipio de Cabezas, provincia Cordillera — Santa Cruz, Bolivia.</>],
                  ['Acceso', <>Frente directo sobre la carretera internacional Argentina — Paraguay, ruta Santa Cruz — Camiri (Ruta 9), transitable todo el año.</>],
                  ['Trazado', <>3,2 km de urbanización, avenida central de 30 m y calles de 13 m.</>],
                ] as [string, React.ReactNode][]
              ).map(([k, v]) => (
                <div key={k} className="grid gap-1 py-4 sm:grid-cols-[7rem_1fr] sm:gap-4">
                  <dt className="annot pt-1 text-stone-400">{k}</dt>
                  <dd className="text-stone-700">{v}</dd>
                </div>
              ))}
            </dl>
            <a
              href="https://maps.google.com/?q=PRH3%2BWJ7+Zanja+Honda,+Cabezas,+Santa+Cruz,+Bolivia"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-block rounded-xl border border-brand/30 px-5 py-3 font-bold text-brand transition hover:bg-brand/5"
            >
              Abrir en Google Maps
            </a>
          </div>
          <div className="card overflow-hidden rounded-3xl">
            <iframe
              title="Ubicación de Prados del Sur en Google Maps"
              src={MAPS_EMBED}
              className="w-full h-80 sm:h-95 border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-stone-50">
        <div className="mx-auto max-w-3xl px-4 py-14">
          <SectionHead annot="Antes de reservar" title="Preguntas frecuentes" />
          <div className="mt-10 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="card group rounded-2xl bg-white px-5 py-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-bold text-stone-900">
                  {q}
                  <span
                    aria-hidden="true"
                    className="text-xl leading-none text-earth transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 border-t border-stone-200 pt-3 text-stone-600">{a}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-stone-500">
            ¿Otra pregunta?{' '}
            <a
              className="font-bold text-brand underline"
              href={waLink(WHATSAPP_VENTAS, 'Hola Terrenalv, tengo una pregunta sobre Prados del Sur.')}
              target="_blank"
              rel="noopener noreferrer"
            >
              Escríbenos por WhatsApp
            </a>
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative isolate bg-linear-to-b from-emerald-900 to-brand text-white">
        <div aria-hidden="true" className="plot-grid absolute inset-0 -z-10" />
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <h2 className="text-balance text-4xl font-black tracking-tight sm:text-5xl">
            Tu lote te está esperando
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-emerald-50/90">
            {(live.disponibles ?? 0) > 0
              ? `Hay ${live.disponibles!.toLocaleString('es-BO')} lotes disponibles ahora mismo. Cada reserva bloquea su lote al instante — el que te gusta hoy puede no estar mañana.`
              : 'Cada reserva bloquea su lote al instante — el que te gusta hoy puede no estar mañana.'}
          </p>
          <Link
            href="/prados-del-sur/mapa"
            className="mt-8 inline-block rounded-2xl bg-earth px-10 py-5 text-lg font-black text-white shadow-[0_14px_36px_-12px_rgba(0,0,0,.7)] ring-1 ring-white/15 transition hover:bg-earth-light"
          >
            Elegir mi lote en el mapa
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t-4 border-earth bg-stone-900 text-stone-300">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 text-sm sm:grid-cols-3">
          <div>
            <Logo variant="inverse" className="h-8 w-auto" />
            <p className="mt-3 font-bold text-earth-tan italic">«Lo que se dice, se cumple»</p>
            <p className="mt-2">
              Empresa boliviana de desarrollo urbano. Proyecto Urbanización Ciudadela Prados del
              Sur. El cliente propone su forma de pago.
            </p>
            <div className="mt-3 flex gap-3">
              {[
                ['Facebook', SOCIAL.facebook],
                ['TikTok', SOCIAL.tiktok],
                ['Instagram', SOCIAL.instagram],
              ].map(([name, url]) => (
                <a
                  key={name}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-white"
                >
                  {name}
                </a>
              ))}
            </div>
          </div>
          <div>
            <p className="annot text-stone-500">Ubicación</p>
            <p className="mt-3">
              Zona Zanja Honda, Municipio de Cabezas,
              <br />
              Provincia Cordillera — Santa Cruz, Bolivia
              <br />
              Carretera internacional Argentina — Paraguay
            </p>
          </div>
          <div>
            <p className="annot text-stone-500">Contacto</p>
            <p className="mt-2">
              <a className="underline hover:text-white" href={waLink(WHATSAPP_VENTAS, 'Hola Terrenalv')}>
                WhatsApp Ventas
              </a>
            </p>
            <p className="mt-1">
              <Link className="underline hover:text-white" href="/reserva">
                Consultar mi reserva
              </Link>
            </p>
            <p className="mt-1">
              {/* Discreet but present: the sales team needs a way in that isn't
                  a memorised URL. The route is auth-gated either way. */}
              <Link className="text-stone-500 underline hover:text-stone-300" href="/admin">
                Acceso equipo
              </Link>
            </p>
          </div>
        </div>
        <p className="text-center text-xs text-stone-500 pb-6">
          © {new Date().getFullYear()} Terrenalv S.R.L. — Todos los derechos reservados
          <span className="mx-2">·</span>
          <a
            href="https://bolivai.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white underline"
          >
            Made by BolivAI
          </a>
        </p>
      </footer>

      {/* Sticky mobile CTA — the reservation is one thumb away at any scroll. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-stone-200 bg-white/95 p-3 shadow-[0_-8px_24px_-12px_rgba(28,25,23,.25)] backdrop-blur-md sm:hidden">
        <Link
          href="/prados-del-sur/mapa"
          className="flex-1 rounded-xl bg-brand py-3.5 text-center font-bold text-white active:bg-emerald-800"
        >
          Ver mapa y reservar
        </Link>
        <a
          href={waLink(WHATSAPP_VENTAS, 'Hola Terrenalv, quiero información sobre Prados del Sur.')}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-brand/30 px-4 py-3.5 font-bold text-brand active:bg-brand/5"
        >
          WhatsApp
        </a>
      </div>
    </div>
  );
}
