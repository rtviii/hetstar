import type { ResidueRef } from "../model/keys";

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
