import {
  realSpaceCorrelationOfSelection,
  type AtomSelector,
  type MapSampler,
  type Track,
} from "@dynamic-pdb/hetkit/metrics";
import { isHeavy, residueKey, type AtomTable } from "@dynamic-pdb/hetkit/model";
import type { MetricPoint } from "../molstar/density";
import { EMPTY_SELECTION, formatRanges, normalizeSelection, rangesContain, selectionToRanges, type LabSelection } from "./selection";

// A locus: a selection the user set apart. It has a component of its own in the 3D view
// (sticks in its colour over the structure, which stays as it is), a row in the loci stack,
// and metrics computed over it. Loci are kept per entry in localStorage under a versioned
// envelope; anything malformed degrades to an empty list. They take the place of the
// selection bookmarks, whose stored entries are read once as loci.

export interface Locus {
  id: string;
  createdAt: number;
  selection: LabSelection;
  /** of its sticks, its mask shell and its row */
  color: number;
  visible: boolean;
  /** its mask drawn in 3D */
  maskShown: boolean;
}

/** the colour scale a locus's RSCC is painted on: fixed, so loci compare with one another */
export const LOCUS_RSCC_DOMAIN: [number, number] = [0.6, 1];

const LOCUS_COLORS = [0x0f9d8f, 0xe07a1f, 0x2a7de1, 0xd1387d, 0x5c9e31, 0xb8860b];

export function newLocus(selection: LabSelection, existing: readonly Locus[]): Locus {
  const free = LOCUS_COLORS.find((color) => !existing.some((locus) => locus.color === color));
  return {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`,
    createdAt: Date.now(),
    selection: normalizeSelection(selection),
    color: free ?? LOCUS_COLORS[existing.length % LOCUS_COLORS.length],
    visible: true,
    maskShown: false,
  };
}

/** "A 15-22, 41 (3 atoms)" */
export function locusLabel(locus: Locus): string {
  const ranges = formatRanges(selectionToRanges(locus.selection), { maxSegments: 3 });
  const atoms = locus.selection.atoms.length;
  return atoms ? `${ranges} (${atoms} atom${atoms === 1 ? "" : "s"})` : ranges;
}

const storageKey = (entryId: string) => `hetstar.lab.loci.${entryId}`;
const bookmarksKey = (entryId: string) => `hetstar.lab.bookmarks.${entryId}`;

function sanitizeSelection(s: unknown): LabSelection {
  if (typeof s !== "object" || s === null) return EMPTY_SELECTION;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = s as any;
  const ranges = Array.isArray(r.ranges)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.ranges.filter((x: any) => x && typeof x.chain === "string" && typeof x.from === "number" && typeof x.to === "number")
    : [];
  const atoms = Array.isArray(r.atoms)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.atoms.filter((x: any) => x && typeof x.chain === "string" && typeof x.seq === "number" && typeof x.atom === "string")
    : [];
  return normalizeSelection({ ranges, atoms });
}

export function loadLoci(entryId: string): Locus[] {
  try {
    const raw = localStorage.getItem(storageKey(entryId)) ?? localStorage.getItem(bookmarksKey(entryId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 || !Array.isArray(parsed.items)) return [];
    const loci: Locus[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of parsed.items as any[]) {
      if (!item || typeof item.id !== "string") continue;
      const selection = sanitizeSelection(item.selection);
      if (!selection.ranges.length && !selection.atoms.length) continue;
      const fresh = newLocus(selection, loci);
      loci.push({
        ...fresh,
        id: item.id,
        createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
        color: typeof item.color === "number" ? item.color : fresh.color,
        // a former bookmark was a remembered selection with nothing drawn
        visible: typeof item.visible === "boolean" ? item.visible : false,
        maskShown: item.maskShown === true,
      });
    }
    return loci;
  } catch {
    return [];
  }
}

export function saveLoci(entryId: string, items: readonly Locus[]): void {
  try {
    localStorage.setItem(storageKey(entryId), JSON.stringify({ v: 1, items }));
  } catch {
    // storage unavailable (private mode, quota): loci stay session-only
  }
}

/** the locus as hetkit selects atoms: whole residues of its ranges, named atoms elsewhere */
export function locusSelector(selection: LabSelection): AtomSelector {
  const atomsOfResidue = new Map<string, Set<string>>();
  for (const atom of selection.atoms) {
    const key = `${atom.chain}|${atom.seq}`;
    const names = atomsOfResidue.get(key) ?? new Set<string>();
    names.add(atom.atom);
    atomsOfResidue.set(key, names);
  }
  return (residue) => {
    if (rangesContain(selection.ranges, residue.ref.chain, residue.ref.seq)) return true;
    return atomsOfResidue.get(`${residue.ref.chain}|${residue.ref.seq}`) ?? false;
  };
}

/** a model as the frames it is scored from: one table, or one per ensemble member */
export interface LocusModel {
  modelId: string;
  name: string;
  states: readonly AtomTable[];
}

export interface LocusScore {
  /** one row per model scored, the main view's model first */
  models: { modelId: string; name: string; value: number; points: number }[];
  /** the locus's residues in the main view's model, each over the shared mask of its selected atoms */
  residues: Track;
  /** the selected atoms of every scored model, each carrying its residue's value in the
   * main view's model: splatted at the mask radius they paint exactly the shared mask */
  paintPoints: MetricPoint[];
}

/** RSCC of a locus in several models, all over the union of their masks of the locus.
 * `models[0]` is the main view's model. */
export function scoreLocus(
  locus: Locus,
  models: readonly LocusModel[],
  sample: MapSampler,
  resolution: number,
): LocusScore {
  const select = locusSelector(locus.selection);
  const result = realSpaceCorrelationOfSelection(
    models.map((model) => model.states),
    sample,
    { resolution, select, mask: "union" },
  );
  const residues = result.residues[0];
  const valueOf = new Map<string, number>();
  residues.keys.forEach((ref, i) => {
    if (!Number.isNaN(residues.values[i])) valueOf.set(residueKey(ref), residues.values[i]);
  });
  const paintPoints: MetricPoint[] = [];
  for (const model of models) {
    for (const table of model.states) {
      for (const residue of table.residues) {
        const value = valueOf.get(residueKey(residue.ref));
        if (value === undefined) continue;
        const selected = select(residue);
        if (selected === false) continue;
        for (const row of residue.rows) {
          if (!isHeavy(table, row) || !(table.occupancy[row] > 0)) continue;
          if (selected !== true && !selected.has(table.atomName[row])) continue;
          paintPoints.push({ x: table.x[row], y: table.y[row], z: table.z[row], value });
        }
      }
    }
  }
  return {
    models: models.map((model, m) => ({ modelId: model.modelId, name: model.name, ...result.pooled[m] })),
    residues,
    paintPoints,
  };
}
