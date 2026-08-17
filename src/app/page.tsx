import Link from 'next/link';
import Script from 'next/script';
import { waLink, formatMoney } from '@/lib/format';
import { Logo } from '@/components/Logo';
import { ActiveReservationBanner } from '@/features/reservations/components/ActiveReservationBanner';
import { MiReservaLink } from '@/features/reservations/components/MiReservaLink';
import { loadLandingData } from '@/features/landing/data';
import { Pasarella, type Slide } from '@/features/landing/Pasarella';

// The company's own marketing flyers, in pasarella/. Alt text describes what
// each one actually says — these are the source for the claims on this page
// (club house, servicios, Derechos Reales), none of which I invented.
const PASARELLA: Slide[] = [
  { src: '/pasarella/01-precio.jpg', alt: 'Terreno de 300 m² desde Bs 24.800 al contado, o en cuotas sin banco. Agua y luz, internet, club house y papeles al día.' },
  { src: '/pasarella/02-comparativa.jpg', alt: 'Prados del Sur frente a otros proyectos: agua, luz, teléfono e internet, sobre la avenida internacional, papeles al día, club house incluido, a 35 minutos de Santa Cruz.' },
  { src: '/pasarella/03-alquiler.jpg', alt: 'Cada mes pagás alquiler por algo que nunca va a ser tuyo, o pagás cuotas por tu propio terreno. Servicios básicos, papeles al día, sin banco.' },
  { src: '/pasarella/04-plusvalia.jpg', alt: 'Invertir en un terreno propio con plusvalía real: sobre la avenida internacional, zona de alto crecimiento, cuotas accesibles y club house incluido.' },
  { src: '/pasarella/05-trayectoria.jpg', alt: '7 años entregando terrenos con todo en orden: papeles registrados en Derechos Reales, servicios básicos instalados y crédito directo sin banco.' },
  { src: '/pasarella/06-avance.jpg', alt: 'Un asesor de Terrenalv frente a los lotes ya abiertos: 60% de los terrenos vendidos, papeles al día, cuotas accesibles, sin bancos.' },
  { src: '/pasarella/07-testimonio.jpg', alt: 'Testimonio de un cliente: compró 15 terrenos buscando una inversión segura y rentable para su familia.' },
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
  { id: '7668793237041057045', caption: '¿Dudas? Visítanos en oficina antes de invertir' },
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
function numeros(totalLotes: number | null): [string, string][] {
  return [
    ['88', 'manzanas'],
    [totalLotes ? totalLotes.toLocaleString('es-BO') : '2.104', 'lotes en el plano'],
    ['300 m²', 'lote típico (10 × 30)'],
    ['4,8 ha', 'de áreas verdes'],
    ['5,6 ha', 'de equipamiento'],
    ['3,2 km', 'de frente sobre la vía'],
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
    'En la zona de Zanja Honda, municipio de Cabezas, provincia Cordillera (Santa Cruz), con frente sobre la carretera Santa Cruz — Camiri. Abajo está el punto en el mapa.',
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
    <span className="rounded-full bg-white/10 border border-white/20 px-4 py-1.5 text-sm font-semibold">
      {children}
    </span>
  );
}

export default async function Home() {
  const live = await loadLandingData();
  const cur = live.currency;

  return (
    <div className="min-h-screen flex flex-col pb-20 sm:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-brand text-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <Link href="/" aria-label="Inicio">
            <Logo variant="inverse" className="h-7 w-auto" />
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/prados-del-sur/mapa"
              className="rounded-full bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-semibold"
            >
              Ver mapa
            </Link>
            <MiReservaLink className="hidden sm:block rounded-full px-4 py-2 text-sm font-semibold hover:bg-white/10">
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
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24 text-center">
          <p className="text-earth-tan font-semibold tracking-widest text-sm uppercase">
            Urbanización Ciudadela · Zanja Honda, Santa Cruz
          </p>
          <h1 className="mt-3 text-4xl sm:text-6xl font-black tracking-tight">Prados del Sur</h1>
          {/* Slogan oficial de Terrenalv S.R.L. */}
          <p className="mt-3 text-earth-tan text-lg sm:text-xl font-bold italic">
            «Lo que se dice, se cumple»
          </p>
          <p className="mt-4 max-w-2xl mx-auto text-emerald-50/90 text-lg">
            88 manzanas con lotes de 300 m² (10 × 30) sobre la carretera Santa Cruz — Camiri.
            El mapa muestra el plano oficial lote por lote: elige el tuyo y resérvalo en minutos
            desde el celular.
          </p>

          {/* Live availability — hidden entirely if the DB is unreachable. */}
          {(live.disponibles ?? 0) > 0 ? (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Chip>
                <span className="text-earth-tan">{live.disponibles!.toLocaleString('es-BO')}</span>{' '}
                lotes disponibles hoy
              </Chip>
              {live.desde !== null ? (
                <Chip>
                  desde <span className="text-earth-tan">{formatMoney(live.desde, cur)}</span>
                </Chip>
              ) : null}
              {live.financing ? (
                <Chip>
                  cuotas desde{' '}
                  <span className="text-earth-tan">
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
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/prados-del-sur/mapa"
              className="rounded-2xl bg-earth text-white font-black px-9 py-5 text-xl shadow-xl hover:bg-earth-light transition"
            >
              Elegir mi lote en el mapa
            </Link>
            <a
              href={waLink(WHATSAPP_VENTAS, 'Hola Terrenalv, quiero información sobre los lotes de Prados del Sur.')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/10 border border-white/25 font-semibold px-8 py-5 text-lg hover:bg-white/20 transition"
            >
              <WhatsappIcon className="h-5 w-5" />
              Hablar por WhatsApp
            </a>
          </div>
          <p className="mt-4 text-sm text-white/70">
            Ves cada lote del plano con su número, medidas y precio. Sin cuenta, sin costo.
          </p>
          <div className="mx-auto mt-6 max-w-md text-stone-900">
            <ActiveReservationBanner />
          </div>
        </div>
      </section>

      {/* El proyecto en números — straight off the CAD plano */}
      <section className="bg-white border-b border-stone-200">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6 text-center">
            {numeros(live.totalLotes).map(([n, label]) => (
              <div key={label}>
                <p className="text-3xl font-black text-brand">{n}</p>
                <p className="mt-1 text-sm text-stone-500">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-stone-400">
            Cifras del plano oficial de la urbanización (levantamiento CAD, mayo 2025).
          </p>
        </div>
      </section>

      {/* Qué incluye — cada punto sale de los materiales de Terrenalv
          (folletos de pasarella/ y sus videos), no de suposiciones mías. */}
      <section className="bg-earth-pale border-b border-stone-200">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center text-brand">
            Qué incluye tu terreno
          </h2>

          <div className="mt-8 grid gap-6 lg:grid-cols-3 items-start">
            {/* Club house: the headline amenity in their own material. */}
            <div className="lg:col-span-1 rounded-2xl bg-earth text-white p-7 shadow-lg">
              <p className="text-xs font-bold uppercase tracking-widest text-earth-tan">
                Incluido
              </p>
              <h3 className="mt-2 text-2xl font-black">Club House</h3>
              <p className="mt-3 text-white/90">
                La ciudadela tiene su propio club house con áreas sociales para las familias de
                Prados del Sur — ya hay lotes habilitados a pasos de él.
              </p>
            </div>

            <ul className="lg:col-span-2 grid gap-4 sm:grid-cols-2">
              {(
                [
                  ['Servicios básicos incluidos', 'Instalados en la urbanización, no prometidos para después.'],
                  ['Papeles al día', 'Registrados en Derechos Reales, todo en orden desde el primer día.'],
                  ['Crédito directo, sin banco', 'Financiamiento propio a sola firma: sin trámites bancarios ni garantes.'],
                  ['A 35 min del km 13 de la doble vía La Guardia', 'Sobre la avenida internacional, cerca de colegio, centro médico y mercado.'],
                ] as [string, string][]
              ).map(([t, b]) => (
                <li key={t} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                  <p className="font-bold text-brand">{t}</p>
                  <p className="mt-1.5 text-sm text-stone-600">{b}</p>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-6 text-center text-sm text-stone-500">
            7 años entregando terrenos con todo en orden.
          </p>
        </div>
      </section>

      {/* Pasarella de fotos — antes de los videos */}
      <section className="bg-stone-50 border-b border-stone-200">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center text-brand">
            El proyecto, en fotos
          </h2>
          <p className="mt-2 text-center text-stone-600 max-w-2xl mx-auto">
            Terrenos, servicios, avances y clientes que ya tienen el suyo.
          </p>
          <div className="mt-8">
            <Pasarella slides={PASARELLA} />
          </div>
        </div>
      </section>

      {/* Videos reales desde redes sociales */}
      <section className="bg-stone-100">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center text-brand">
            Mira el proyecto en video
          </h2>
          <p className="mt-2 text-center text-stone-600 max-w-2xl mx-auto">
            Avances de obra, recorridos y entregas de terrenos, directo de nuestras redes —
            siempre lo último que publicamos.
          </p>

          {/* Featured videos — fixed, verified posts so the section has real
              content immediately, before the profile widgets hydrate. */}
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {FEATURED_TIKTOKS.map((v) => (
              <figure key={v.id} className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
                <div className="overflow-hidden rounded-xl bg-stone-900">
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

          <div className="mt-8 grid gap-6 lg:grid-cols-2 items-start">
            {/* TikTok: official creator embed — shows their latest videos. */}
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-stone-900">TikTok — @{SOCIAL.tiktokUser}</h3>
                <a
                  href={SOCIAL.tiktok}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-brand hover:underline"
                >
                  Ver perfil →
                </a>
              </div>
              <div className="mt-3 overflow-hidden rounded-xl min-h-125">
                <blockquote
                  className="tiktok-embed"
                  cite={SOCIAL.tiktok}
                  data-unique-id={SOCIAL.tiktokUser}
                  data-embed-type="creator"
                  style={{ maxWidth: '780px', minWidth: '288px', margin: 0 }}
                >
                  <section>
                    <a target="_blank" rel="noopener noreferrer" href={SOCIAL.tiktok}>
                      @{SOCIAL.tiktokUser}
                    </a>
                  </section>
                </blockquote>
              </div>
            </div>

            {/* Facebook: page timeline plugin — latest posts and videos. */}
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-stone-900">Facebook — Terrenalv.srl</h3>
                <a
                  href={SOCIAL.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-brand hover:underline"
                >
                  Ver página →
                </a>
              </div>
              <div className="mt-3 overflow-hidden rounded-xl">
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
        <Script src="https://www.tiktok.com/embed.js" strategy="lazyOnload" />
      </section>

      {/* Plan de pago — live desde la base de datos */}
      <section className="bg-white border-y border-stone-200">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center text-brand">
            ¿Cuánto necesito para empezar?
          </h2>

          <div className="mt-8 grid gap-4 sm:grid-cols-3 max-w-4xl mx-auto">
            <div className="rounded-2xl border-2 border-earth-tan bg-earth-pale p-6 text-center">
              <p className="text-sm font-semibold uppercase tracking-wide text-earth">
                Hoy, para asegurar tu lote
              </p>
              <p className="mt-2 text-3xl font-black text-stone-900">
                {live.sena ? formatMoney(live.sena.amount, live.sena.currency) : 'Una seña'}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                Se paga por QR al reservar y se descuenta íntegra del precio del lote.
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                Cuota inicial
              </p>
              {/* A fixed cuota inicial is quoted in bolivianos even though the
                  lot is priced in dólares — show it in its own currency. */}
              <p className="mt-2 text-3xl font-black text-stone-900">
                {live.financing
                  ? formatMoney(live.financing.downPayment, live.financing.downPaymentCurrency)
                  : '—'}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                {live.financing && live.tipico
                  ? `Con eso arrancas, sea cual sea el lote. Un lote típico cuesta ${formatMoney(live.tipico, cur)}.`
                  : 'Se confirma con tu asesor al reservar.'}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                Cuota mensual
              </p>
              {/* Only the minimum is published. The term depends on conditions
                  Terrenalv agrees in person, so no "N cuotas" here. */}
              <p className="mt-2 text-3xl font-black text-stone-900">
                {live.financing
                  ? `desde ${formatMoney(
                      live.financing.monthly,
                      live.financing.minMonthly !== null
                        ? live.financing.downPaymentCurrency
                        : cur,
                    )}`
                  : '—'}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                Crédito directo, sin banco y a sola firma. El plazo lo armas con tu asesor.
              </p>
            </div>
          </div>

          {/* Slogan-backed differentiator: en Terrenalv el cliente propone su
              forma de pago — the plan above is a reference, not a cage. */}
          <div className="mt-8 max-w-3xl mx-auto rounded-2xl bg-earth text-white p-6 sm:p-8 text-center shadow-lg">
            <p className="text-xl sm:text-2xl font-black">Tú propones tu forma de pago</p>
            <p className="mt-2 text-white/85">
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
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center text-brand">
            ¿Cómo reservo mi lote?
          </h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-4">
            {PASOS.map(([n, title, body]) => (
              <li key={n} className="text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-brand text-white font-black text-xl flex items-center justify-center">
                  {n}
                </div>
                <p className="mt-3 font-bold">{title}</p>
                <p className="mt-1 text-sm text-stone-600">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-center">
            <Link
              href="/prados-del-sur/mapa"
              className="inline-block rounded-2xl bg-brand text-white font-bold px-8 py-4 hover:bg-emerald-800 transition"
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
            <h2 className="text-2xl sm:text-3xl font-extrabold text-brand">¿Dónde queda?</h2>
            <ul className="mt-5 space-y-3 text-stone-700">
              <li className="flex gap-3">
                <span className="text-brand font-black">•</span>
                Zona <strong>Zanja Honda</strong>, municipio de Cabezas, provincia Cordillera —
                Santa Cruz, Bolivia.
              </li>
              <li className="flex gap-3">
                <span className="text-brand font-black">•</span>
                Frente directo sobre la <strong>carretera Santa Cruz — Camiri</strong> (Ruta 9),
                con acceso todo el año.
              </li>
              <li className="flex gap-3">
                <span className="text-brand font-black">•</span>
                3,2 km de urbanización con una avenida central de 30 m y calles de 13 m, tal
                como figura en el plano aprobado.
              </li>
            </ul>
            <a
              href="https://maps.google.com/?q=PRH3%2BWJ7+Zanja+Honda,+Cabezas,+Santa+Cruz,+Bolivia"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-block rounded-xl border border-brand/30 px-5 py-3 font-bold text-brand hover:bg-brand/5"
            >
              Abrir en Google Maps
            </a>
          </div>
          <div className="overflow-hidden rounded-2xl border border-stone-200 shadow-sm">
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
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center text-brand">
            Preguntas frecuentes
          </h2>
          <div className="mt-8 space-y-3">
            {FAQ.map(([q, a]) => (
              <details
                key={q}
                className="group rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <summary className="cursor-pointer list-none font-bold text-stone-900 flex items-center justify-between gap-3 min-h-11">
                  {q}
                  <span className="text-brand transition-transform group-open:rotate-45 text-xl leading-none">
                    +
                  </span>
                </summary>
                <p className="mt-2 text-stone-600">{a}</p>
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
      <section className="bg-linear-to-b from-emerald-900 to-brand text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h2 className="text-3xl sm:text-4xl font-black">Tu lote te está esperando</h2>
          <p className="mt-3 text-emerald-50/90 max-w-xl mx-auto">
            {(live.disponibles ?? 0) > 0
              ? `Hay ${live.disponibles!.toLocaleString('es-BO')} lotes disponibles ahora mismo. Cada reserva bloquea su lote al instante — el que te gusta hoy puede no estar mañana.`
              : 'Cada reserva bloquea su lote al instante — el que te gusta hoy puede no estar mañana.'}
          </p>
          <Link
            href="/prados-del-sur/mapa"
            className="mt-7 inline-block rounded-2xl bg-earth text-white font-bold px-10 py-4 text-lg shadow-lg hover:bg-earth-light transition"
          >
            Elegir mi lote en el mapa
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto bg-stone-900 text-stone-300">
        <div className="mx-auto max-w-6xl px-4 py-10 grid gap-6 sm:grid-cols-3 text-sm">
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
            <p className="font-bold text-white">Ubicación</p>
            <p className="mt-2">
              Zona Zanja Honda, Municipio de Cabezas,
              <br />
              Provincia Cordillera — Santa Cruz, Bolivia
            </p>
          </div>
          <div>
            <p className="font-bold text-white">Contacto</p>
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
      <div className="fixed inset-x-0 bottom-0 z-30 sm:hidden border-t border-stone-200 bg-white/95 backdrop-blur p-3 flex gap-2">
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
