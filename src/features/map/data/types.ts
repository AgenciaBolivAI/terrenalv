// Client-side geometry snapshot + status types (the contract between the 2D map,
// the 3D scene, the Builder, and the loaders).

import type { Ring } from '../lib/types';
import type { ElementKind, LotStatus, ManzanaKind } from '@/lib/db-types';

/** Shape of maps/{slug}/geometry-v{N}.json (built by publish_geometry). */
export interface GeometrySnapshot {
  v: number;
  bbox: [number, number, number, number];
  manzanas: SnapshotManzana[];
  lots: SnapshotLot[];
  elements: SnapshotElement[];
}

export interface SnapshotManzana {
  id: string;
  code: string;
  kind: ManzanaKind;
  sector: string | null;
  needs_review: boolean;
  ring: Ring;
}

export interface SnapshotLot {
  id: string;
  mz: string; // manzana id
  n: string; // lot number
  f: number | null; // frontage m
  d: number | null; // depth m
  a: number; // official area m²
  corner: boolean;
  ring: Ring;
}

export interface SnapshotElement {
  id: string;
  kind: ElementKind;
  name: string | null;
  props: Record<string, unknown>;
  geojson: { type: 'Polygon' | 'LineString'; coordinates: number[][][] | number[][] };
}

export interface LotStatusEntry {
  st: LotStatus;
  priced: boolean;
  price: number | null;
}

export interface StatusSnapshot {
  status_rev: number;
  server_now: string;
  lots: ({ id: string } & LotStatusEntry)[];
}

/** Realtime broadcast payload from the lots trigger. */
export interface LotStatusEvent {
  lot_id: string;
  status: LotStatus;
  status_rev: number;
}

/** Parsed, render-ready lot (path precomputed once at load). */
export interface MapLot {
  id: string;
  manzanaId: string;
  number: string;
  frontage: number | null;
  depth: number | null;
  area: number;
  corner: boolean;
  ring: Ring;
  path: string; // SVG d, y already flipped
  bbox: [number, number, number, number];
}

export interface MapManzana {
  id: string;
  code: string;
  kind: ManzanaKind;
  sector: string | null;
  needsReview: boolean;
  ring: Ring;
  path: string;
  bbox: [number, number, number, number];
  lotIds: string[];
  labelCenter: [number, number]; // svg coords
}

export interface MapElement {
  id: string;
  kind: ElementKind;
  name: string | null;
  props: Record<string, unknown>;
  path: string;
  isLine: boolean;
  labelCenter: [number, number];
}
