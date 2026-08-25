import type { AtomTable } from "./atoms";
import { BACKBONE_ATOMS, isHeavy } from "./atoms";
import type { ResidueRef } from "./keys";

// Summary of the altloc structure of one model. Built per-atom, not per-residue:
// qFit output splits sidechain-only in some files and backbone+sidechain in others,
// so an altloc letter never implies a complete residue.
export interface AltlocSummary {
  /** every altloc letter observed, sorted */
  altIds: string[];
  /** residues carrying at least one altloc, in file order */
  residues: AltlocResidue[];
  totalResidueCount: number;
  /** fraction of atoms (all elements) carrying an altloc */
  atomFractionWithAltloc: number;
  /** every multi-letter atom group sums to 1 within OCC_SUM_TOL */
  occupancySumOk: boolean;
  /** number of (residue, atom name) groups whose letter occupancies do not sum to 1 */
  badOccupancyGroups: number;
}

export interface AltlocResidue {
  ref: ResidueRef;
  compId: string;
  /** letters on this residue, sorted; parallel to occupancies and atomCounts */
  altIds: string[];
  /** occupancy per letter, read off the first heavy atom carrying it (NaN if inconsistent reads are fine here) */
  occupancies: number[];
  /** does the split reach the protein backbone (N/CA/C/O), or is it sidechain-only?
   * Residues without backbone atom names (ligands, waters) count as 'full'. */
  scope: "full" | "sidechain";
  /** heavy atoms per letter, parallel to altIds */
  atomCounts: number[];
}

export const OCC_SUM_TOL = 0.02;

export function summarizeAltlocs(table: AtomTable): AltlocSummary | null {
  const globalLetters = new Set<string>();
  let altAtoms = 0;
  for (let i = 0; i < table.count; i++) {
    if (table.altId[i]) {
      globalLetters.add(table.altId[i]);
      altAtoms++;
    }
  }
  if (globalLetters.size === 0) return null;

  const residues: AltlocResidue[] = [];
  let badGroups = 0;

  for (const entry of table.residues) {
    const letters = new Set<string>();
    for (const r of entry.rows) if (table.altId[r]) letters.add(table.altId[r]);
    if (letters.size === 0) continue;

    const altIds = [...letters].sort();
    const occupancies: number[] = [];
    const atomCounts: number[] = [];
    let backboneSplit = false;
    let hasBackbone = false;

    for (const r of entry.rows) {
      if (BACKBONE_ATOMS.has(table.atomName[r])) {
        hasBackbone = true;
        if (table.altId[r]) backboneSplit = true;
      }
    }
    for (const letter of altIds) {
      let occ = NaN;
      let heavy = 0;
      for (const r of entry.rows) {
        if (table.altId[r] !== letter) continue;
        if (!isHeavy(table, r)) continue;
        heavy++;
        if (Number.isNaN(occ)) occ = table.occupancy[r];
      }
      occupancies.push(occ);
      atomCounts.push(heavy);
    }

    // sum-to-1 invariant per (residue, atom name) group with 2 or more letters
    const byName = new Map<string, number[]>();
    for (const r of entry.rows) {
      if (!table.altId[r] || !isHeavy(table, r)) continue;
      const list = byName.get(table.atomName[r]);
      if (list) list.push(r);
      else byName.set(table.atomName[r], [r]);
    }
    for (const rows of byName.values()) {
      if (rows.length < 2) continue;
      let sum = 0;
      for (const r of rows) sum += table.occupancy[r];
      if (Math.abs(sum - 1) > OCC_SUM_TOL) badGroups++;
    }

    residues.push({
      ref: entry.ref,
      compId: entry.compId,
      altIds,
      occupancies,
      scope: hasBackbone && !backboneSplit ? "sidechain" : "full",
      atomCounts,
    });
  }

  return {
    altIds: [...globalLetters].sort(),
    residues,
    totalResidueCount: table.residues.length,
    atomFractionWithAltloc: altAtoms / table.count,
    occupancySumOk: badGroups === 0,
    badOccupancyGroups: badGroups,
  };
}
