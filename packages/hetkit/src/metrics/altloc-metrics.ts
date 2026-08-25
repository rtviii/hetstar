import type { AtomTable } from "../model/atoms";
import { isHeavy } from "../model/atoms";
import type { Track } from "./tracks";
import { makeTrack } from "./tracks";

// Altloc-derived single-model metrics, all residue-level over heavy atoms.

/** Distinct altloc letters on the residue; 1 when it carries none. */
export function conformerCount(table: AtomTable): Track {
  const values = new Float32Array(table.residues.length);
  table.residues.forEach((res, i) => {
    const letters = new Set<string>();
    for (const r of res.rows) if (table.altId[r] && isHeavy(table, r)) letters.add(table.altId[r]);
    values[i] = Math.max(1, letters.size);
  });
  return makeTrack(
    "conformer-count",
    "residue",
    table.residues.map((r) => r.ref),
    values,
  );
}

// Per-letter occupancy of a residue, read off the first heavy atom carrying the letter.
function letterOccupancies(table: AtomTable, rows: number[]): number[] {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const alt = table.altId[r];
    if (!alt || !isHeavy(table, r) || seen.has(alt)) continue;
    seen.set(alt, table.occupancy[r]);
  }
  return [...seen.values()];
}

/** Shannon entropy (bits) of the residue's conformer occupancies; 0 for single-conformer.
 * Occupancies are renormalized to sum to 1 before the sum. */
export function occupancyEntropy(table: AtomTable): Track {
  const values = new Float32Array(table.residues.length);
  table.residues.forEach((res, i) => {
    const occs = letterOccupancies(table, res.rows).filter((o) => o > 0);
    if (occs.length < 2) {
      values[i] = 0;
      return;
    }
    const total = occs.reduce((a, b) => a + b, 0);
    let h = 0;
    for (const o of occs) {
      const p = o / total;
      h -= p * Math.log2(p);
    }
    values[i] = h;
  });
  return makeTrack(
    "occupancy-entropy",
    "residue",
    table.residues.map((r) => r.ref),
    values,
    { unit: "bits" },
  );
}

/** Occupancy-weighted RMSF across altloc conformers: for each heavy atom name carried by
 * 2+ letters, the RMS deviation from the occupancy-weighted centroid; residue value is the
 * mean over such atom names. 0 when the residue has no splits. */
export function altlocRmsf(table: AtomTable): Track {
  const values = new Float32Array(table.residues.length);
  table.residues.forEach((res, i) => {
    const byName = new Map<string, number[]>();
    for (const r of res.rows) {
      if (!table.altId[r] || !isHeavy(table, r)) continue;
      const list = byName.get(table.atomName[r]);
      if (list) list.push(r);
      else byName.set(table.atomName[r], [r]);
    }
    let sum = 0;
    let n = 0;
    for (const rows of byName.values()) {
      if (rows.length < 2) continue;
      let w = 0;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const r of rows) {
        const o = table.occupancy[r];
        w += o;
        cx += o * table.x[r];
        cy += o * table.y[r];
        cz += o * table.z[r];
      }
      if (w <= 0) continue;
      cx /= w;
      cy /= w;
      cz /= w;
      let msd = 0;
      for (const r of rows) {
        const dx = table.x[r] - cx;
        const dy = table.y[r] - cy;
        const dz = table.z[r] - cz;
        msd += (table.occupancy[r] / w) * (dx * dx + dy * dy + dz * dz);
      }
      sum += Math.sqrt(msd);
      n++;
    }
    values[i] = n > 0 ? sum / n : 0;
  });
  return makeTrack(
    "altloc-rmsf",
    "residue",
    table.residues.map((r) => r.ref),
    values,
    { unit: "A" },
  );
}
