'use client';

// Click-to-load wrapper for third-party embeds.
//
// The landing page carried ELEVEN iframes — six TikTok, three Instagram, one
// Facebook, one Google Maps — and every one of them loaded on arrival. Each
// drags in another company's JavaScript, fonts and trackers before the visitor
// has asked to watch anything, on phones over Bolivian mobile data. The page
// took seconds to settle and half the boxes were still grey when it did, which
// reads as broken rather than slow.
//
// So nothing third-party loads until the visitor clicks. What renders first is
// a real, styled card that costs nothing; the click swaps in the iframe and
// autoplays where the provider supports it, so the extra tap buys the video
// rather than just delaying it.
//
// Deliberately NOT IntersectionObserver: scrolling past a section is not the
// same as wanting to watch six videos, and lazily loading on scroll still pays
// the whole cost for anyone who reaches the bottom of the page.

import { useState } from 'react';

export type EmbedNetwork = 'tiktok' | 'instagram' | 'facebook' | 'maps';

const NETWORK: Record<EmbedNetwork, { name: string; action: string; ring: string; fill: string }> = {
  tiktok: { name: 'TikTok', action: 'Reproducir', ring: 'ring-stone-800/15', fill: 'bg-stone-900' },
  instagram: { name: 'Instagram', action: 'Reproducir', ring: 'ring-pink-500/20', fill: 'bg-pink-600' },
  facebook: { name: 'Facebook', action: 'Ver publicaciones', ring: 'ring-blue-500/20', fill: 'bg-blue-600' },
  maps: { name: 'Google Maps', action: 'Ver el mapa', ring: 'ring-brand/20', fill: 'bg-brand' },
};

function PlayGlyph({ network }: { network: EmbedNetwork }) {
  if (network === 'maps') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-6 w-6">
        <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-6 w-6">
      <path d="M8 5.14v13.72L19 12 8 5.14Z" />
    </svg>
  );
}

export function EmbedFacade({
  src,
  title,
  network,
  caption,
  height,
  className,
}: {
  /** Loaded only after the visitor asks for it. */
  src: string;
  title: string;
  network: EmbedNetwork;
  /** Line shown on the facade, so the card says something before it loads. */
  caption?: string;
  height: number;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const meta = NETWORK[network];

  if (loaded) {
    return (
      <iframe
        title={title}
        src={src}
        className={`w-full border-0 ${className ?? ''}`}
        style={{ height }}
        loading="lazy"
        scrolling="no"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; web-share"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      // The accessible name has to say what the click DOES, because visually the
      // card is mostly a play button and a caption.
      aria-label={`Cargar ${meta.name}: ${caption ?? title}`}
      style={{ height }}
      className={`group flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl
                  bg-linear-to-b from-stone-100 to-stone-200 p-6 text-center ring-1 ${meta.ring}
                  transition-colors hover:from-stone-50 hover:to-stone-100
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-earth
                  ${className ?? ''}`}
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg
                    transition-transform duration-200 group-hover:scale-110
                    motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${meta.fill}`}
      >
        <PlayGlyph network={network} />
      </span>
      <span className="annot text-stone-500">{meta.name}</span>
      {caption ? (
        <span className="max-w-xs text-balance text-sm font-semibold text-stone-700">{caption}</span>
      ) : null}
      <span className="text-xs font-medium text-earth">{meta.action} →</span>
    </button>
  );
}
