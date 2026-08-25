import type { AtomTable } from "../model/atoms";
import { isHeavy } from "../model/atoms";
import { residueKey } from "../model/keys";
import type { Track } from "./tracks";
import { makeTrack } from "./tracks";

// Per-residue displacement between two models of the same molecule, e.g. the deposited
// single-conformer structure vs its qFit multiconformer re-refinement. Residues correspond
// by auth chain/seq/ins; within a residue, each shared heavy ATOM NAME is compared through
// its occupancy-weighted centroid on each side, which absorbs the conformer-count mismatch
// (a 3-way qFit split vs one deposited position) and skips atoms present on one side only
// (hydrogens, truncated sidechains). No superposition is performed: models refined against
// the same data share a frame; superpose upstream if yours do not.

type Centroids = Map<string, { x: number; y: number; z: number }>;

function residueCentroidsByAtomName(table: AtomTable, rows: number[]): Centroids {
  const acc = new Map<string, { w: number; x: number; y: number; z: number }>();
  for (const r of rows) {
    if (!isHeavy(table, r)) continue;
    const name = table.atomName[r];
    const o = table.occupancy[r] > 0 ? table.occupancy[r] : 0;
    const a = acc.get(name) ?? { w: 0, x: 0, y: 0, z: 0 };
    // an all-zero-occupancy atom group still deserves a centroid: fall back to unweighted
    const w = o > 0 ? o : 1e-6;
    a.w += w;
    a.x += w * table.x[r];
    a.y += w * table.y[r];
    a.z += w * table.z[r];
    acc.set(name, a);
  }
  const out: Centroids = new Map();
  for (const [name, a] of acc) out.set(name, { x: a.x / a.w, y: a.y / a.w, z: a.z / a.w });
  return out;
}

/** Track keyed by the residues of `a` (file order); NaN where `b` has no counterpart
 * residue or no shared heavy atom names. */
export function modelRmsd(a: AtomTable, b: AtomTable): Track {
  const values = new Float32Array(a.residues.length);
  a.residues.forEach((res, i) => {
    const bi = b.residueIndex.get(residueKey(res.ref));
    if (bi === undefined) {
      values[i] = NaN;
      return;
    }
    const ca = residueCentroidsByAtomName(a, res.rows);
    const cb = residueCentroidsByAtomName(b, b.residues[bi].rows);
    let msd = 0;
    let n = 0;
    for (const [name, pa] of ca) {
      const pb = cb.get(name);
      if (!pb) continue;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dz = pa.z - pb.z;
      msd += dx * dx + dy * dy + dz * dz;
      n++;
    }
    values[i] = n > 0 ? Math.sqrt(msd / n) : NaN;
  });
  return makeTrack(
    "model-rmsd",
    "residue",
    a.residues.map((r) => r.ref),
    values,
    { unit: "A" },
  );
}
