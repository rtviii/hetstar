import type { ResidueRange } from "../molstar/conformers";

// The multi-range selection model of the viewer: an ordered, normalized list of
// author-keyed residue ranges, refined by individual atoms (LabSelection below). Residue-
// level consumers (lanes columns, popup, flyout, conformers, clip) read the derived
// selectionToRanges(); only the click handler, the 3D marker and bookmarks see atoms.
// Shift-click funnels through the toggle functions so overlapping and adjacent ranges
// of one chain always merge, and re-clicking a selected element removes it.

/** Sort by chain then start, merge same-chain overlapping/adjacent ranges. */
export function normalizeRanges(ranges: readonly ResidueRange[]): ResidueRange[] {
  const sorted = ranges
    .map((r) => ({ chain: r.chain, from: Math.min(r.from, r.to), to: Math.max(r.from, r.to) }))
    .sort((a, b) => (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : a.from - b.from));
  const out: ResidueRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.chain === r.chain && r.from <= last.to + 1) {
      if (r.to > last.to) last.to = r.to;
    } else {
      out.push(r);
    }
  }
  return out;
}

export function addRange(sel: readonly ResidueRange[], r: ResidueRange): ResidueRange[] {
  return normalizeRanges([...sel, r]);
}

export function rangesContain(sel: readonly ResidueRange[], chain: string, seq: number): boolean {
  return sel.some((r) => r.chain === chain && seq >= r.from && seq <= r.to);
}

/** Subtract one interval from the list, splitting ranges that contain it strictly. */
export function removeRange(sel: readonly ResidueRange[], r: ResidueRange): ResidueRange[] {
  const from = Math.min(r.from, r.to);
  const to = Math.max(r.from, r.to);
  const out: ResidueRange[] = [];
  for (const cur of sel) {
    if (cur.chain !== r.chain || to < cur.from || from > cur.to) {
      out.push(cur);
      continue;
    }
    if (cur.from < from) out.push({ chain: cur.chain, from: cur.from, to: from - 1 });
    if (cur.to > to) out.push({ chain: cur.chain, from: to + 1, to: cur.to });
  }
  return out;
}

// --- atom-refined selection ---

/** A single atom, altloc-agnostic: selecting it means every conformer copy of that atom. */
export interface AtomSel {
  chain: string;
  seq: number;
  /** label_atom_id */
  atom: string;
}

export interface LabSelection {
  ranges: ResidueRange[];
  atoms: AtomSel[];
}

export const EMPTY_SELECTION: LabSelection = { ranges: [], atoms: [] };

export function atomsContain(atoms: readonly AtomSel[], a: AtomSel): boolean {
  return atoms.some((x) => x.chain === a.chain && x.seq === a.seq && x.atom === a.atom);
}

/** Ranges normalized; atoms deduped, sorted, and absorbed when a range already covers their residue. */
export function normalizeSelection(sel: LabSelection): LabSelection {
  const ranges = normalizeRanges(sel.ranges);
  const seen = new Set<string>();
  const atoms: AtomSel[] = [];
  for (const a of sel.atoms) {
    const key = `${a.chain}|${a.seq}|${a.atom}`;
    if (seen.has(key) || rangesContain(ranges, a.chain, a.seq)) continue;
    seen.add(key);
    atoms.push(a);
  }
  atoms.sort((x, y) =>
    x.chain !== y.chain ? (x.chain < y.chain ? -1 : 1) : x.seq !== y.seq ? x.seq - y.seq : x.atom < y.atom ? -1 : x.atom > y.atom ? 1 : 0,
  );
  return { ranges, atoms };
}

export function selectionIsEmpty(sel: LabSelection): boolean {
  return sel.ranges.length === 0 && sel.atoms.length === 0;
}

/**
 * The residue-level view: ranges plus one single-residue range per atom's parent, normalized.
 * Adjacent parents merge, so this is NOT invertible — LabSelection stays the source of truth.
 */
export function selectionToRanges(sel: LabSelection): ResidueRange[] {
  if (sel.atoms.length === 0) return normalizeRanges(sel.ranges);
  return normalizeRanges([
    ...sel.ranges,
    ...sel.atoms.map((a) => ({ chain: a.chain, from: a.seq, to: a.seq })),
  ]);
}

/** File-browser toggle of a whole residue: selected -> remove (splitting its range), partially selected (atoms) -> promote to full residue, else add. */
export function toggleResidue(sel: LabSelection, chain: string, seq: number): LabSelection {
  const one: ResidueRange = { chain, from: seq, to: seq };
  const dropAtoms = sel.atoms.filter((a) => !(a.chain === chain && a.seq === seq));
  if (rangesContain(sel.ranges, chain, seq)) {
    return { ranges: removeRange(sel.ranges, one), atoms: dropAtoms };
  }
  return normalizeSelection({ ranges: [...sel.ranges, one], atoms: dropAtoms });
}

/**
 * Toggle one atom (or a bond's two end atoms): all picked already selected -> remove them,
 * otherwise add the missing ones. Removing an atom that is only covered by a range explodes
 * the residue: the range loses that residue and its OTHER atom names come back as atom items
 * (enumerated by the caller from the atom table, keeping this module pure).
 */
export function toggleAtoms(
  sel: LabSelection,
  picked: readonly AtomSel[],
  residueAtomNames: (chain: string, seq: number) => string[],
): LabSelection {
  const isSelected = (s: LabSelection, a: AtomSel) =>
    atomsContain(s.atoms, a) || rangesContain(s.ranges, a.chain, a.seq);
  let cur = sel;
  if (picked.every((a) => isSelected(cur, a))) {
    for (const a of picked) {
      if (atomsContain(cur.atoms, a)) {
        cur = { ranges: cur.ranges, atoms: cur.atoms.filter((x) => !(x.chain === a.chain && x.seq === a.seq && x.atom === a.atom)) };
      } else if (rangesContain(cur.ranges, a.chain, a.seq)) {
        const rest = residueAtomNames(a.chain, a.seq)
          .filter((name) => name !== a.atom)
          .map((name) => ({ chain: a.chain, seq: a.seq, atom: name }));
        cur = {
          ranges: removeRange(cur.ranges, { chain: a.chain, from: a.seq, to: a.seq }),
          atoms: [...cur.atoms, ...rest],
        };
      }
    }
  } else {
    for (const a of picked) {
      if (!isSelected(cur, a)) cur = { ranges: cur.ranges, atoms: [...cur.atoms, a] };
    }
  }
  return normalizeSelection(cur);
}

export function selectionAtomCount(sel: LabSelection): number {
  return sel.atoms.length;
}

/** "A 15-22, 41, 78-90" — the chain label repeats only when it changes; over budget -> "+n more". */
export function formatRanges(sel: readonly ResidueRange[], opts: { maxSegments?: number } = {}): string {
  const max = opts.maxSegments ?? sel.length;
  const shown = sel.slice(0, max);
  const parts: string[] = [];
  let prevChain: string | null = null;
  for (const r of shown) {
    const span = r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`;
    parts.push(r.chain === prevChain ? span : `${r.chain} ${span}`);
    prevChain = r.chain;
  }
  const rest = sel.length - shown.length;
  return parts.join(", ") + (rest > 0 ? ` +${rest} more` : "");
}
