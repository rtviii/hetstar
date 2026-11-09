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

export interface StateSupportRow {
  state: string;
  /** heavy atoms of the state with a valid sample */
  atomCount: number;
  /** plain mean of sampled values over the state's heavy atoms; NaN when none sampled */
  mean: number;
  /** heavy atoms of the state farther than `exclusiveDistance` from every heavy atom of
   * every other state (shared rows are never exclusive) */
  exclusiveCount: number;
  /** mean over the exclusive atoms only; NaN when the state has none */
  exclusiveMean: number;
}

/** Per-state density support for one hetcif variable (the browser cousin of the Python
 * package's per-state support, ~/dev/hetcif docs/metrics.md): `stateRows` maps each state
 * id to its atom_site rows (hetkit's hetcif row index). Each state's heavy atoms are
 * sampled, over all of them and over the atoms no other state comes near, because the
 * other states' density contaminates the shared region. Feed the 2mFo-DFc sampler for
 * support, the Fo-Fc sampler for local error; values stay in the sampler's units. */
export function stateSupport(
  table: AtomTable,
  stateRows: Map<string, number[]>,
  sample: MapSampler,
  opts: { exclusiveDistance?: number } = {},
): StateSupportRow[] {
  const d2 = (opts.exclusiveDistance ?? 0.5) ** 2;
  const heavyRows = new Map<string, number[]>();
  for (const [sid, rows] of stateRows) heavyRows.set(sid, rows.filter((r) => isHeavy(table, r)));
  const out: StateSupportRow[] = [];
  for (const [sid, rows] of heavyRows) {
    const others: number[] = [];
    for (const [o, orows] of heavyRows) if (o !== sid) for (const r of orows) others.push(r);
    let n = 0;
    let sum = 0;
    let xn = 0;
    let xsum = 0;
    for (const r of rows) {
      const v = sample(table.x[r], table.y[r], table.z[r]);
      if (Number.isNaN(v)) continue;
      n++;
      sum += v;
      let exclusive = true;
      for (const q of others) {
        if (q === r) { exclusive = false; break; }
        const dx = table.x[r] - table.x[q];
        const dy = table.y[r] - table.y[q];
        const dz = table.z[r] - table.z[q];
        if (dx * dx + dy * dy + dz * dz <= d2) { exclusive = false; break; }
      }
      if (exclusive) {
        xn++;
        xsum += v;
      }
    }
    out.push({ state: sid, atomCount: n, mean: n ? sum / n : NaN, exclusiveCount: xn, exclusiveMean: xn ? xsum / xn : NaN });
  }
  return out;
}
