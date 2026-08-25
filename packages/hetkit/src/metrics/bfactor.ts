import type { AtomTable } from "../model/atoms";
import { isHeavy } from "../model/atoms";
import type { Track } from "./tracks";
import { makeTrack } from "./tracks";

/** Occupancy-weighted mean B_iso over heavy atoms (weighting keeps split atoms from
 * counting more than once). NaN when the residue has no B values. */
export function bIsoMean(table: AtomTable): Track {
  const values = new Float32Array(table.residues.length);
  table.residues.forEach((res, i) => {
    let w = 0;
    let sum = 0;
    for (const r of res.rows) {
      const b = table.bIso[r];
      if (!isHeavy(table, r) || Number.isNaN(b)) continue;
      const o = table.occupancy[r];
      w += o;
      sum += o * b;
    }
    values[i] = w > 0 ? sum / w : NaN;
  });
  return makeTrack(
    "b-iso-mean",
    "residue",
    table.residues.map((r) => r.ref),
    values,
    { unit: "A^2" },
  );
}
