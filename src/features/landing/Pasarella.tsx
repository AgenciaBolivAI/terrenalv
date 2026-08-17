'use client';

// Photo carousel for the landing page.
//
// Scroll-snap rather than a transform track: swiping is native on a phone (the
// thing most visitors use), keyboard and screen readers get real focusable
// slides for free, and there is no drag maths to get wrong. Auto-advance stops
// on hover, on focus, when the tab is hidden, and permanently once the visitor
// takes control — an image that keeps sliding away while someone reads it is
// worse than no carousel.

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Slide {
  src: string;
  alt: string;
}

const AUTO_MS = 5000;

export function Pasarella({ slides }: { slides: Slide[] }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const takenOver = useRef(false);

  const goTo = useCallback((i: number, smooth = true) => {
    const track = trackRef.current;
    if (!track) return;
    const n = track.children.length;
    if (!n) return;
    const target = ((i % n) + n) % n;
    const child = track.children[target] as HTMLElement;
    track.scrollTo({ left: child.offsetLeft - track.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  /** Any deliberate interaction ends auto-advance for the rest of the visit. */
  const takeOver = useCallback(() => {
    takenOver.current = true;
    setPaused(true);
  }, []);

  // Which slide is centred — derived from scroll position, so it stays right
  // whether the move came from a swipe, a dot, or the timer.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mid = track.scrollLeft + track.clientWidth / 2;
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < track.children.length; i++) {
          const c = track.children[i] as HTMLElement;
          const d = Math.abs(c.offsetLeft - track.offsetLeft + c.clientWidth / 2 - mid);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        setIndex(best);
      });
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      track.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setIndex((i) => {
        const next = (i + 1) % slides.length;
        goTo(next);
        return next;
      });
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [paused, slides.length, goTo]);

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(takenOver.current)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(takenOver.current)}
    >
      <div
        ref={trackRef}
        onPointerDown={takeOver}
        onWheel={takeOver}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2
                   [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-roledescription="carrusel"
        aria-label="Fotos del proyecto Prados del Sur"
      >
        {slides.map((s, i) => (
          <figure
            key={s.src}
            className="w-[78%] shrink-0 snap-center sm:w-[46%] lg:w-[31%]"
            aria-roledescription="diapositiva"
            aria-label={`${i + 1} de ${slides.length}`}
          >
            <Image
              src={s.src}
              alt={s.alt}
              width={900}
              height={1125}
              sizes="(max-width: 640px) 78vw, (max-width: 1024px) 46vw, 31vw"
              className="h-auto w-full rounded-2xl border border-stone-200 bg-white shadow-sm"
              priority={i === 0}
            />
          </figure>
        ))}
      </div>

      {/* Arrows: pointer devices only — on a phone you swipe. */}
      {slides.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() => {
              takeOver();
              goTo(index - 1);
            }}
            aria-label="Foto anterior"
            className="absolute left-1 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center
                       rounded-full bg-white/90 text-brand shadow-md ring-1 ring-stone-200
                       hover:bg-white sm:flex"
          >
            <span aria-hidden="true" className="text-xl leading-none">‹</span>
          </button>
          <button
            type="button"
            onClick={() => {
              takeOver();
              goTo(index + 1);
            }}
            aria-label="Foto siguiente"
            className="absolute right-1 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center
                       rounded-full bg-white/90 text-brand shadow-md ring-1 ring-stone-200
                       hover:bg-white sm:flex"
          >
            <span aria-hidden="true" className="text-xl leading-none">›</span>
          </button>
        </>
      ) : null}

      <div className="mt-3 flex justify-center gap-2">
        {slides.map((s, i) => (
          <button
            key={s.src}
            type="button"
            onClick={() => {
              takeOver();
              goTo(i);
            }}
            aria-label={`Ir a la foto ${i + 1}`}
            aria-current={i === index}
            className={`h-2.5 rounded-full transition-all ${
              i === index ? 'w-6 bg-earth' : 'w-2.5 bg-stone-300 hover:bg-stone-400'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
