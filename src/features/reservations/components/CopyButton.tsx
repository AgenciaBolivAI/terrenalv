'use client';

import { useEffect, useRef, useState } from 'react';

/** Small tap-to-copy button with confirmation state (big touch target). */
export function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: select-nothing fallback — just show the value is tappable.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
        copied
          ? 'border-green-300 bg-green-50 text-green-700'
          : 'border-stone-300 bg-white text-stone-700 active:bg-stone-100'
      }`}
      aria-live="polite"
    >
      {copied ? '¡Copiado!' : label}
    </button>
  );
}
