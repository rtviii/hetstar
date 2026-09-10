import type { ResidueRef } from "../model/keys";
import { residueKey } from "../model/keys";

// A Track is DATA: a per-key scalar series any consumer (1D sequence strip, 3D color
// theme, comparison table) can render without knowing where the numbers came from.
// Computing in the browser is one producer; loading a precomputed artifact file from
// the ETL is another. Both meet here.

export type Level = "atom" | "residue" | "chain" | "model";

export interface Track {
  metricId: string;
  level: Level;
  unit?: string;
  /** range for color/axis mapping; data range unless the metric overrides it */
  domain: [number, number];
  /** parallel to values; residue-level keys (atom-level tracks come later) */
  keys: ResidueRef[];
  /** NaN = metric undefined at that key */
  values: Float32Array;
}

export interface TrackJSON {
  metricId: string;
  level: Level;
  unit?: string;
  domain: [number, number];
  keys: ResidueRef[];
  /** null stands in for NaN */
  values: (number | null)[];
}

export function makeTrack(
  metricId: string,
  level: Level,
  keys: ResidueRef[],
  values: Float32Array,
  opts: { unit?: string; domainHint?: [number, number] } = {},
): Track {
  let domain = opts.domainHint;
  if (!domain) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    domain = min <= max ? [min, max] : [0, 1];
  }
  return { metricId, level, unit: opts.unit, domain, keys, values };
}

/** Per-key difference a - b, matched by residue key. Keys (and their order) come from `a`;
 * NaN where `b` has no counterpart or either side is NaN. The domain is symmetric about 0
 * (max absolute difference), so diverging color ramps center correctly. */
export function trackDelta(a: Track, b: Track, opts: { metricId?: string } = {}): Track {
  const bIndex = new Map<string, number>();
  b.keys.forEach((k, i) => bIndex.set(residueKey(k), i));
  const values = new Float32Array(a.keys.length);
  for (let i = 0; i < a.keys.length; i++) {
    const bi = bIndex.get(residueKey(a.keys[i]));
    values[i] = bi === undefined ? NaN : a.values[i] - b.values[bi];
  }
  let m = 0;
  for (let i = 0; i < values.length; i++) {
    const v = Math.abs(values[i]);
    if (!Number.isNaN(v) && v > m) m = v;
  }
  return {
    metricId: opts.metricId ?? `${a.metricId}-delta`,
    level: a.level,
    unit: a.unit === b.unit ? a.unit : undefined,
    domain: [-(m || 1), m || 1],
    keys: a.keys,
    values,
  };
}

/** Mask a track to a residue scope: values outside keep NaN. The domain is deliberately
 * left unchanged so colors stay comparable as the scope moves. */
export function scopeTrack(t: Track, include: (ref: ResidueRef) => boolean): Track {
  const values = new Float32Array(t.values.length);
  for (let i = 0; i < t.keys.length; i++) values[i] = include(t.keys[i]) ? t.values[i] : NaN;
  return { ...t, values };
}

export function trackToJSON(t: Track): TrackJSON {
  return {
    metricId: t.metricId,
    level: t.level,
    unit: t.unit,
    domain: t.domain,
    keys: t.keys,
    values: Array.from(t.values, (v) => (Number.isNaN(v) ? null : v)),
  };
}

export function trackFromJSON(j: TrackJSON): Track {
  const values = new Float32Array(j.values.length);
  for (let i = 0; i < j.values.length; i++) values[i] = j.values[i] == null ? NaN : (j.values[i] as number);
  return { metricId: j.metricId, level: j.level, unit: j.unit, domain: j.domain, keys: j.keys, values };
}
