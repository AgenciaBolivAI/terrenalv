// 3D scene palette + vertical layout constants. Status colors mirror the CSS
// custom props in src/app/globals.css (--lot-*) so 2D, 3D, and the legend stay
// in lockstep. THREE.Color converts sRGB hex → linear working space (three's
// color management is on by default), which is what vertex-color buffers need.
//
// This module is only ever imported through Scene3D (next/dynamic, ssr:false),
// so constructing THREE objects at module scope is safe.

import * as THREE from 'three';
import type { LotStatusEntry } from '../data/types';

// ---- Lot status fills (see globals.css) -----------------------------------
export const LOT_STATUS_HEX = {
  disponible: '#86efac',
  disponibleSinPrecio: '#f0fdf4',
  reservado: '#fdba74',
  vendido: '#d6d3d1',
  no_disponible: '#e7e5e4',
} as const;

const STATUS_COLOR = {
  disponible: new THREE.Color(LOT_STATUS_HEX.disponible),
  disponibleSinPrecio: new THREE.Color(LOT_STATUS_HEX.disponibleSinPrecio),
  reservado: new THREE.Color(LOT_STATUS_HEX.reservado),
  vendido: new THREE.Color(LOT_STATUS_HEX.vendido),
  no_disponible: new THREE.Color(LOT_STATUS_HEX.no_disponible),
} as const;

/** Status entry → fill color (unknown lots read as neutral, never "available"). */
export function lotColor(entry: LotStatusEntry | undefined): THREE.Color {
  if (!entry) return STATUS_COLOR.no_disponible;
  if (entry.st === 'disponible') {
    return entry.priced ? STATUS_COLOR.disponible : STATUS_COLOR.disponibleSinPrecio;
  }
  return STATUS_COLOR[entry.st] ?? STATUS_COLOR.no_disponible;
}

// ---- Ground / environment --------------------------------------------------
export const SKY_COLOR = '#dceef7';
export const TERRAIN_GRASS_LOW = '#7cab63';
export const TERRAIN_GRASS_HIGH = '#a6ca8b';
export const ROAD_COLOR = '#78716c'; // stone-500, reads as compacted road
export const GREEN_COLOR = '#8fd6a4'; // area_verde (2D uses #bbf7d0; darkened for sun)
export const PAD_AMENIDAD_HEX = '#7dd3fc'; // .el-amenidad
export const PAD_EQUIPAMIENTO_HEX = '#fbcfe8'; // .mz-equipamiento
export const PAD_RAILWAY_HEX = '#c9c2b6'; // .el-railway — ballast, not asphalt
export const OUTLINE_COLOR = '#57534e'; // stone-600 lot outlines
export const SELECT_FILL = '#3b82f6';
export const SELECT_STROKE = '#1d4ed8'; // matches .lot-path.selected
export const LABEL_COLOR = '#44403c'; // .map-label

// ---- Vertical layout (meters). Terrain relief is flattened to 0 under all
// built footprints; everything man-made floats in thin layers above it. ------
export const TERRAIN_AMPLITUDE = 1.5;
export const GREEN_Y = 0.04;
export const ROAD_Y = 0.05;
export const PAD_Y = 0.06;
export const LOT_BASE_Y = 0.02;
export const LOT_HEIGHT = 0.15;
export const SELECT_BASE_Y = 0.03;
export const SELECT_HEIGHT = 0.22;
export const LABEL_Y = 2;
export const BILLBOARD_Y = 9;
