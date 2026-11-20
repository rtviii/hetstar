import type { AtomTable } from "../model/atoms";
import { isHeavy } from "../model/atoms";
import { residueKey } from "../model/keys";
import type { Track } from "./tracks";

// Map-derived metrics. The map enters as a plain sampler function so this layer stays
// Mol*-free and testable headless: the viewer builds the sampler from a volume (wrapped
// trilinear interpolation over the pristine full-cell grid, values in sigma units); a
// test hands in any function of position. NaN from the sampler means "no data here".

export type MapSampler = (x: number, y: number, z: number) => number;

// Occupancy-weighted mean of sampled values over a residue's heavy atoms, plus the signed
// value of the largest-magnitude sample. Occupancy weighting keeps a split residue's
// alternates contributing in proportion to their modeled population.
function residueMapStats(
  table: AtomTable,
  rows: number[],
  sample: MapSampler,
): { mean: number; peak: number } {
  let w = 0;
  let sum = 0;
  let peak = NaN;
  for (const r of rows) {
    if (!isHeavy(table, r)) continue;
    const v = sample(table.x[r], table.y[r], table.z[r]);
    if (Number.isNaN(v)) continue;
    const o = table.occupancy[r] > 0 ? table.occupancy[r] : 1e-6;
    w += o;
    sum += o * v;
    if (Number.isNaN(peak) || Math.abs(v) > Math.abs(peak)) peak = v;
  }
  return { mean: w > 0 ? sum / w : NaN, peak };
}

function symmetricDomain(values: Float32Array): [number, number] {
  let m = 0;
  for (let i = 0; i < values.length; i++) {
    const v = Math.abs(values[i]);
    if (!Number.isNaN(v) && v > m) m = v;
  }
  return [-(m || 1), m || 1];
}

/** Sample a map at a model's heavy atoms, per residue: the occupancy-weighted mean signed
 * value and the signed value of the largest-magnitude sample. With the Fo-Fc difference
 * map in sigma units this is the "unexplained density" pair of tracks (`<prefix>-mean`,
 * `<prefix>-peak`). Both domains are symmetric about 0. */
export function mapValueTracks(
  table: AtomTable,
  sample: MapSampler,
  opts: { idPrefix?: string; unit?: string } = {},
): { mean: Track; peak: Track } {
  const prefix = opts.idPrefix ?? "map";
  const unit = opts.unit ?? "sigma";
  const means = new Float32Array(table.residues.length);
  const peaks = new Float32Array(table.residues.length);
  table.residues.forEach((res, i) => {
    const s = residueMapStats(table, res.rows, sample);
    means[i] = s.mean;
    peaks[i] = s.peak;
  });
  const keys = table.residues.map((r) => r.ref);
  return {
    mean: { metricId: `${prefix}-mean`, level: "residue", unit, domain: symmetricDomain(means), keys, values: means },
    peak: { metricId: `${prefix}-peak`, level: "residue", unit, domain: symmetricDomain(peaks), keys, values: peaks },
  };
}

export interface ConformerSupportRow {
  /** altloc letter; "" for the residue's shared (unsplit) atoms */
  alt: string;
  /** mean occupancy over the row's heavy atoms (a letter's atoms share it in practice) */
  occupancy: number;
  atomCount: number;
  /** plain (unweighted) mean of sampled values over the row's heavy atoms; NaN when no
   * atom produced a valid sample. Within one letter all atoms share the occupancy, so no
   * weighting applies; normalizing by occupancy is a DISPLAY choice left to the caller. */
  mean: number;
}

/** Per-conformer density support for ONE residue (sense 1: state vs state within a
 * multiconformer model): group the residue's heavy atoms by altloc letter (plus a ""
 * row for the shared atoms) and report each group's mean sampled map value. Feed the
 * 2Fo-Fc sampler for support, the Fo-Fc sampler for local error. */
export function conformerSupport(table: AtomTable, rows: number[], sample: MapSampler): ConformerSupportRow[] {
  const groups = new Map<string, { occSum: number; n: number; vSum: number; vN: number }>();
  for (const r of rows) {
    if (!isHeavy(table, r)) continue;
    const alt = table.altId[r];
    let g = groups.get(alt);
    if (!g) {
      g = { occSum: 0, n: 0, vSum: 0, vN: 0 };
      groups.set(alt, g);
    }
    g.occSum += table.occupancy[r];
    g.n++;
    const v = sample(table.x[r], table.y[r], table.z[r]);
    if (!Number.isNaN(v)) {
      g.vSum += v;
      g.vN++;
    }
  }
  const out: ConformerSupportRow[] = [];
  for (const [alt, g] of groups) {
    out.push({ alt, occupancy: g.n > 0 ? g.occSum / g.n : NaN, atomCount: g.n, mean: g.vN > 0 ? g.vSum / g.vN : NaN });
  }
  out.sort((a, b) => (a.alt === b.alt ? 0 : a.alt === "" ? -1 : b.alt === "" ? 1 : a.alt < b.alt ? -1 : 1));
  return out;
}

/** Which model sits in more density: per residue, the occupancy-weighted mean map value
 * at `a`'s heavy atoms minus at `b`'s, matched by auth residue key. Keyed by `a`'s
 * residues; NaN where `b` has no counterpart or either side has no valid samples.
 * Symmetric domain (positive = `a` better supported). */
export function mapSupportDelta(
  a: AtomTable,
  b: AtomTable,
  sample: MapSampler,
  opts: { metricId?: string; unit?: string } = {},
): Track {
  const values = new Float32Array(a.residues.length);
  a.residues.forEach((res, i) => {
    const bi = b.residueIndex.get(residueKey(res.ref));
    if (bi === undefined) {
      values[i] = NaN;
      return;
    }
    const sa = residueMapStats(a, res.rows, sample);
    const sb = residueMapStats(b, b.residues[bi].rows, sample);
    values[i] = sa.mean - sb.mean;
  });
  return {
    metricId: opts.metricId ?? "support-delta",
    level: "residue",
    unit: opts.unit ?? "sigma",
    domain: symmetricDomain(values),
    keys: a.residues.map((r) => r.ref),
    values,
  };
}
