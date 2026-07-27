import Link from 'next/link';
import { waLink } from '@/lib/format';
import { Logo } from '@/components/Logo';
import { ActiveReservationBanner } from '@/features/reservations/components/ActiveReservationBanner';
import { MiReservaLink } from '@/features/reservations/components/MiReservaLink';

const WHATSAPP_VENTAS = '+59169000000'; // TODO: replace with the real sales number

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-brand text-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <Link href="/" aria-label="Inicio">
            <Logo variant="inverse" className="h-7 w-auto" />
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/estrellas-del-sur/mapa"
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

      {/* Hero */}
      <section className="bg-linear-to-b from-brand to-emerald-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24 text-center">
          <p className="text-amber-300 font-semibold tracking-widest text-sm uppercase">
            Urbanización · Zanja Honda, Santa Cruz
          </p>
          <h1 className="mt-3 text-4xl sm:text-6xl font-black tracking-tight">
            Estrellas del Sur
          </h1>
          <p className="mt-4 max-w-2xl mx-auto text-emerald-50/90 text-lg">
            Lotes desde 250 m² sobre la Carretera Internacional Ruta 9
            (Argentina–Paraguay), con mega piscina, club house y áreas verdes.
            Elige tu lote en el mapa y resérvalo en minutos.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/estrellas-del-sur/mapa"
              className="rounded-2xl bg-amber-400 text-emerald-950 font-bold px-8 py-4 text-lg shadow-lg hover:bg-amber-300 transition"
            >
              Explorar el mapa de lotes
            </Link>
            <a
              href={waLink(WHATSAPP_VENTAS, 'Hola Terrenalv, quiero información sobre los lotes de Estrellas del Sur.')}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl bg-white/10 border border-white/25 font-semibold px-8 py-4 text-lg hover:bg-white/20 transition"
            >
              Hablar por WhatsApp
            </a>
          </div>
          <div className="mx-auto mt-6 max-w-md text-stone-900">
            <ActiveReservationBanner />
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="mx-auto max-w-6xl px-4 py-14 grid gap-6 sm:grid-cols-3">
        {[
          {
            title: 'Sobre la Ruta 9',
            body: 'Frente a la Carretera Internacional Argentina–Paraguay, a minutos de Zanja Honda. Acceso directo todo el año.',
          },
          {
            title: 'Mega piscina y club house',
            body: 'Áreas sociales de primer nivel para las familias de la ciudadela: piscina semiolímpica, parrilleros y parques.',
          },
          {
            title: 'Reserva 100% en línea',
            body: 'Mira la disponibilidad en tiempo real, reserva tu lote y envía tu comprobante QR desde el celular.',
          },
        ].map((f) => (
          <div key={f.title} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h3 className="font-bold text-lg text-brand">{f.title}</h3>
            <p className="mt-2 text-stone-600">{f.body}</p>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section className="bg-white border-y border-stone-200">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center text-brand">
            ¿Cómo reservo mi lote?
          </h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-4">
            {[
              ['1', 'Explora el mapa', 'Verde = disponible. Toca un lote para ver medidas y precio.'],
              ['2', 'Reserva con tus datos', 'Nombre, carnet y celular. Sin crear cuenta.'],
              ['3', 'Paga con QR', 'Transfiere la seña con el QR de tu banco y sube el comprobante.'],
              ['4', 'Confirmación', 'Nuestro equipo verifica tu pago y el lote queda a tu nombre.'],
            ].map(([n, title, body]) => (
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
              href="/estrellas-del-sur/mapa"
              className="inline-block rounded-2xl bg-brand text-white font-bold px-8 py-4 hover:bg-emerald-800 transition"
            >
              Ver lotes disponibles
            </Link>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto bg-stone-900 text-stone-300">
        <div className="mx-auto max-w-6xl px-4 py-10 grid gap-6 sm:grid-cols-3 text-sm">
          <div>
            <Logo variant="inverse" className="h-8 w-auto" />
            <p className="mt-3">
              Empresa boliviana de desarrollo urbano. Proyecto Ciudadela Prados del Sur y
              Urbanización Estrellas del Sur.
            </p>
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
    </div>
  );
}
