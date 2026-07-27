'use client';

// Search box: 'M-12' zooms to the manzana; 'M-12 5', 'M-12-L-5', 'M12 L5'
// select + zoom to a lot. Matching is separator-insensitive.

import React, { useRef, useState } from 'react';
import { useMapStore } from '../store/useMapStore';
import type { ViewportController } from './viewbox';

const keyOf = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

interface SearchTarget {
  manzanaId: string;
  lotId: string | null;
}

function resolveQuery(query: string): SearchTarget | null {
  const state = useMapStore.getState();
  const tokens = query.trim().toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!tokens.length) return null;

  const byKey = new Map(state.manzanas.map((m) => [keyOf(m.code), m] as const));
  const tryMz = (parts: string[]) => byKey.get(parts.join('')) ?? null;

  let mzTokens = tokens;
  let lotNum: string | null = null;
  const last = tokens[tokens.length - 1];

  if (tokens.length >= 2 && /^\d+[A-Z]?$/.test(last)) {
    let before = tokens.slice(0, -1);
    if (before.length && /^L(OTE)?$/.test(before[before.length - 1])) before = before.slice(0, -1);
    if (tryMz(before)) {
      mzTokens = before;
      lotNum = last;
    }
  } else if (tokens.length >= 2 && /^L\d+[A-Z]?$/.test(last) && tryMz(tokens.slice(0, -1))) {
    mzTokens = tokens.slice(0, -1);
    lotNum = last.slice(1);
  }

  const mz = tryMz(mzTokens);
  if (!mz) return null;
  if (lotNum === null) return { manzanaId: mz.id, lotId: null };

  const wanted = lotNum;
  const wantedNumeric = /^\d+$/.test(wanted) ? String(parseInt(wanted, 10)) : null;
  for (const id of mz.lotIds) {
    const lot = state.lots.get(id);
    if (!lot) continue;
    const n = lot.number.toUpperCase();
    if (n === wanted || (wantedNumeric !== null && /^\d+$/.test(n) && String(parseInt(n, 10)) === wantedNumeric)) {
      return { manzanaId: mz.id, lotId: id };
    }
  }
  return null;
}

export function LotSearch({
  controllerRef,
}: {
  controllerRef: React.RefObject<ViewportController | null>;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = resolveQuery(value);
    if (!target) {
      setError(true);
      return;
    }
    setError(false);
    const controller = controllerRef.current;
    if (target.lotId) {
      useMapStore.getState().selectLot(target.lotId);
      controller?.zoomToLot(target.lotId);
    } else {
      controller?.zoomToManzana(target.manzanaId);
    }
    inputRef.current?.blur();
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex flex-col items-center gap-1 px-3">
      <form
        onSubmit={submit}
        className="pointer-events-auto flex w-full max-w-90 items-center gap-1 rounded-full bg-white/95 py-1 pl-4 pr-1 shadow-md backdrop-blur"
      >
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          autoComplete="off"
          enterKeyHint="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(false);
          }}
          placeholder="Buscar: M-12 o M-12 5"
          aria-label="Buscar manzana o lote"
          className="h-8 w-full min-w-0 bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400"
        />
        <button
          type="submit"
          className="h-8 shrink-0 rounded-full bg-brand px-3.5 text-xs font-semibold text-white active:bg-brand-light"
        >
          Buscar
        </button>
      </form>
      {error ? (
        <p className="pointer-events-auto rounded-full bg-red-50 px-3 py-1 text-[11px] font-medium text-red-700 shadow-sm">
          No encontrado. Prueba con «M-12» o «M-12 5».
        </p>
      ) : null}
    </div>
  );
}
