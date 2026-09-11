import type { AtomTable } from "../model/atoms";
import { isHeavy } from "../model/atoms";
import type { Track } from "./tracks";
import { makeTrack } from "./tracks";

// Per-residue RMSF across the members of a multi-MODEL ensemble (one AtomTable per
// member, built with buildAtomTable's modelNum option). Atoms correspond by auth
// chain/seq/ins + atom name + altloc; each atom's fluctuation is the RMS deviation from
// its mean position over the members it appears in (>= 2), and the residue value is the
// unweighted mean over its heavy atoms. NO superposition is performed: members of an
// ensemble refinement share the crystal frame; NMR-style bundles must be superposed
// upstream or the values absorb rigid-body drift.

interface Acc {
  n: number;
  sx: number;
  sy: number;
  sz: number;
  /** sum of |r|^2 */
  s2: number;
}

function atomKey(t: AtomTable, r: number): string {
  return `${t.chain[r]}|${t.seq[r]}|${t.ins[r]}|${t.atomName[r]}|${t.altId[r]}`;
}

/** Track keyed by the FIRST member's residues; NaN where no heavy atom recurs. */
export function ensembleRmsf(models: AtomTable[]): Track {
  const first = models[0];
  const acc = new Map<string, Acc>();
  for (const t of models) {
    for (let r = 0; r < t.count; r++) {
      if (!isHeavy(t, r)) continue;
      const key = atomKey(t, r);
      let a = acc.get(key);
      if (!a) {
        a = { n: 0, sx: 0, sy: 0, sz: 0, s2: 0 };
        acc.set(key, a);
      }
      const x = t.x[r], y = t.y[r], z = t.z[r];
      a.n++;
      a.sx += x;
      a.sy += y;
      a.sz += z;
      a.s2 += x * x + y * y + z * z;
    }
  }
  const values = new Float32Array(first.residues.length);
  first.residues.forEach((res, i) => {
    let sum = 0;
    let n = 0;
    for (const r of res.rows) {
      if (!isHeavy(first, r)) continue;
      const a = acc.get(atomKey(first, r));
      if (!a || a.n < 2) continue;
      const mx = a.sx / a.n, my = a.sy / a.n, mz = a.sz / a.n;
      const variance = Math.max(0, a.s2 / a.n - (mx * mx + my * my + mz * mz));
      sum += Math.sqrt(variance);
      n++;
    }
    values[i] = n > 0 ? sum / n : NaN;
  });
  return makeTrack(
    "ensemble-rmsf",
    "residue",
    first.residues.map((r) => r.ref),
    values,
    { unit: "A" },
  );
}
