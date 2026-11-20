import type { AtomTable } from "../model/atoms";
import { isHeavy } from "../model/atoms";
import type { MapSampler } from "../metrics/map";

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
