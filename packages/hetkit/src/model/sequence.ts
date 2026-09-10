import type { AtomTable } from "./atoms";
import type { MolCifBlock, MolCifCategory, MolCifFile } from "./cif";
import { normValue } from "./cif";
import type { ResidueRef } from "./keys";
import { residueKey } from "./keys";

// The polymer sequence of each chain as 1-based POSITIONS (the entity sequence index,
// label_seq_id in wwPDB terms) bridged to the auth-keyed ResidueRefs that the rest of
// this package, Mol* picks and qFit output all speak. This is the 1D coordinate every
// sequence lane draws in; the bridge is what turns a lane selection into a structure
// selection and a 3D pick into a column.
//
// Sources, in preference order:
//   1. _pdbx_poly_seq_scheme (wwPDB deposition files): the full SEQRES per chain,
//      unobserved residues included, each with the author number the depositor gave it.
//   2. _atom_site alone (qFit / Phenix outputs carry no sequence categories): the
//      observed polymer residues in file order, at label_seq_id when the file has it,
//      else 1..n.
// Observed-ness always comes from the AtomTable the caller passes (the model on
// screen), so a deposited file's scheme can frame its qFit sibling: same entry, same
// author numbering, no sequence categories of its own.

export interface SequencePosition {
  /** 1-based index in the chain's polymer sequence */
  pos: number;
  compId: string;
  /** one-letter code, 'X' when unknown */
  letter: string;
  /** author-keyed residue; null when the scheme names no author number for it */
  ref: ResidueRef | null;
  /** the shown model has atoms for this residue */
  observed: boolean;
}

export interface ChainSequence {
  /** author chain id (pdb_strand_id) */
  chain: string;
  labelAsymId: string | null;
  entityId: string | null;
  length: number;
  /** positions 1..length, in order */
  positions: SequencePosition[];
  /** the one-letter string, one char per position */
  letters: string;
  source: "poly_seq_scheme" | "atom_site";
  /** positions coincide with label_seq_id (true for the scheme; for atom_site when the file has the field) */
  positionsAreLabelSeq: boolean;
  /** residueKey(ref) -> pos, observed or not */
  posByKey: Map<string, number>;
}

export interface SequenceModel {
  chains: ChainSequence[];
  byChain: Map<string, ChainSequence>;
  /** label_asym_id -> author chain, for joining categories keyed by label ids */
  authOfLabelAsym: Map<string, string>;
}

export interface Span {
  start: number;
  end: number;
}

export interface SecondarySpan extends Span {
  kind: "helix" | "strand";
}

export const THREE_TO_ONE: Readonly<Record<string, string>> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
  LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V",
  MSE: "M", SEC: "U", PYL: "O",
  A: "A", C: "C", G: "G", U: "U", I: "I", N: "N",
  DA: "A", DC: "C", DG: "G", DT: "T", DI: "I", DN: "N",
};

export function oneLetter(compId: string): string {
  return THREE_TO_ONE[compId.toUpperCase()] ?? "X";
}

export function isPolymerComp(compId: string): boolean {
  return compId.toUpperCase() in THREE_TO_ONE;
}

export interface BuildSequenceOptions {
  blockIndex?: number;
}

/**
 * Build the per-chain sequence model. `file` is the sequence source (the deposited
 * mmCIF when there is one); `table` is the model on screen, which decides what counts as
 * observed and contributes chains the source does not name.
 */
export function buildSequenceModel(
  file: MolCifFile,
  table: AtomTable | null,
  opts: BuildSequenceOptions = {},
): SequenceModel {
  const block = file.blocks[opts.blockIndex ?? 0];
  const observedKeys = table ? table.residueIndex : null;
  const chains: ChainSequence[] = block ? fromScheme(block, observedKeys) : [];
  if (chains.length === 0 && block) chains.push(...fromAtomSite(block, observedKeys));

  // chains the shown model has that the source does not: frame them from the table
  if (table) {
    const known = new Set(chains.map((c) => c.chain));
    for (const c of fromTable(table)) if (!known.has(c.chain)) chains.push(c);
  }

  const byChain = new Map<string, ChainSequence>();
  const authOfLabelAsym = new Map<string, string>();
  for (const c of chains) {
    byChain.set(c.chain, c);
    if (c.labelAsymId) authOfLabelAsym.set(c.labelAsymId, c.chain);
  }
  return { chains, byChain, authOfLabelAsym };
}

/** The position of an author-keyed residue in its chain, or null when the chain does not carry it. */
export function positionOf(model: SequenceModel, ref: ResidueRef): number | null {
  return model.byChain.get(ref.chain)?.posByKey.get(residueKey(ref)) ?? null;
}

/** The author-keyed residue at a position; null off the ends or where the scheme gives no author number. */
export function refAt(chain: ChainSequence, pos: number): ResidueRef | null {
  return chain.positions[pos - 1]?.ref ?? null;
}

/** Runs of positions the shown model has no atoms for. */
export function unobservedSpans(chain: ChainSequence): Span[] {
  const spans: Span[] = [];
  let start: number | null = null;
  for (const p of chain.positions) {
    if (p.observed) {
      if (start !== null) {
        spans.push({ start, end: p.pos - 1 });
        start = null;
      }
    } else if (start === null) {
      start = p.pos;
    }
  }
  if (start !== null) spans.push({ start, end: chain.length });
  return spans;
}

/**
 * Helix and strand spans per author chain, in positions. Read from _struct_conf (HELX_*
 * only; turns and bends would draw as noise) and _struct_sheet_range. Both are keyed by
 * label ids, joined to author chains through the model; where the chain's positions are
 * not label_seq_ids the author fields are used instead. A file without the categories
 * yields an empty map, not an error.
 */
export function readSecondaryStructure(
  file: MolCifFile,
  model: SequenceModel,
  opts: BuildSequenceOptions = {},
): Map<string, SecondarySpan[]> {
  const out = new Map<string, SecondarySpan[]>();
  const block = file.blocks[opts.blockIndex ?? 0];
  if (!block) return out;
  const push = (chain: string, span: SecondarySpan) => {
    const list = out.get(chain) ?? [];
    list.push(span);
    out.set(chain, list);
  };
  const conf = block.categories["struct_conf"];
  if (conf) {
    const type = conf.getField("conf_type_id");
    for (let r = 0; r < conf.rowCount; r++) {
      const t = type ? normValue(type.str(r)).toUpperCase() : "HELX";
      if (!t.startsWith("HELX")) continue;
      const s = spanFromRow(conf, r, model);
      if (s) push(s.chain, { start: s.start, end: s.end, kind: "helix" });
    }
  }
  const sheet = block.categories["struct_sheet_range"];
  if (sheet) {
    for (let r = 0; r < sheet.rowCount; r++) {
      const s = spanFromRow(sheet, r, model);
      if (s) push(s.chain, { start: s.start, end: s.end, kind: "strand" });
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.start - b.start);
  return out;
}

// --- internals ---

function fromScheme(block: MolCifBlock, observedKeys: Map<string, number> | null): ChainSequence[] {
  const cat = block.categories["pdbx_poly_seq_scheme"];
  if (!cat || cat.rowCount === 0) return [];
  const fAsym = cat.getField("asym_id");
  const fEntity = cat.getField("entity_id");
  const fSeq = cat.getField("seq_id");
  const fMon = cat.getField("mon_id");
  const fAuthNum = cat.getField("pdb_seq_num") ?? cat.getField("auth_seq_num");
  const fStrand = cat.getField("pdb_strand_id");
  const fIns = cat.getField("pdb_ins_code");
  const fPdbMon = cat.getField("pdb_mon_id") ?? cat.getField("auth_mon_id");
  if (!fAsym || !fSeq || !fMon) return [];

  interface Draft {
    labelAsymId: string;
    chain: string;
    entityId: string | null;
    rows: Map<number, SequencePosition>;
  }
  const drafts = new Map<string, Draft>();
  for (let r = 0; r < cat.rowCount; r++) {
    const asym = normValue(fAsym.str(r));
    const seqId = fSeq.int(r);
    if (!asym || !Number.isFinite(seqId) || seqId < 1) continue;
    let d = drafts.get(asym);
    if (!d) {
      const strand = fStrand ? normValue(fStrand.str(r)) : "";
      d = { labelAsymId: asym, chain: strand || asym, entityId: fEntity ? normValue(fEntity.str(r)) || null : null, rows: new Map() };
      drafts.set(asym, d);
    }
    // microheterogeneity (hetero = y) lists one seq_id twice; the first row stands
    if (d.rows.has(seqId)) continue;
    const compId = normValue(fMon.str(r));
    const authNum = fAuthNum ? fAuthNum.int(r) : NaN;
    const ins = fIns ? normValue(fIns.str(r)) : "";
    const ref: ResidueRef | null = Number.isFinite(authNum) ? { chain: d.chain, seq: authNum, ins } : null;
    const observed = observedKeys
      ? !!ref && observedKeys.has(residueKey(ref))
      : !!fPdbMon && normValue(fPdbMon.str(r)) !== "";
    d.rows.set(seqId, { pos: seqId, compId, letter: oneLetter(compId), ref, observed });
  }

  const chains: ChainSequence[] = [];
  for (const d of drafts.values()) {
    const seqIds = [...d.rows.keys()].sort((a, b) => a - b);
    // positions are the scheme's seq_ids; a scheme that skips one leaves a hole we fill
    // with an unknown so pos stays equal to seq_id
    const length = seqIds[seqIds.length - 1];
    const positions: SequencePosition[] = [];
    for (let pos = 1; pos <= length; pos++) {
      positions.push(d.rows.get(pos) ?? { pos, compId: "UNK", letter: "X", ref: null, observed: false });
    }
    chains.push(finish(d.chain, d.labelAsymId, d.entityId, positions, "poly_seq_scheme", true));
  }
  return chains;
}

function fromAtomSite(block: MolCifBlock, observedKeys: Map<string, number> | null): ChainSequence[] {
  const at = block.categories["atom_site"];
  if (!at || at.rowCount === 0) return [];
  const fGroup = at.getField("group_PDB");
  const fChain = at.getField("auth_asym_id") ?? at.getField("label_asym_id");
  const fLabelAsym = at.getField("label_asym_id");
  const fEntity = at.getField("label_entity_id");
  const fSeq = at.getField("auth_seq_id") ?? at.getField("label_seq_id");
  const fLabelSeq = at.getField("label_seq_id");
  const fIns = at.getField("pdbx_PDB_ins_code");
  const fComp = at.getField("auth_comp_id") ?? at.getField("label_comp_id");
  const fModel = at.getField("pdbx_PDB_model_num");
  if (!fChain || !fSeq || !fComp) return [];

  interface Draft {
    chain: string;
    labelAsymId: string | null;
    entityId: string | null;
    residues: { ref: ResidueRef; compId: string; labelSeq: number }[];
    seen: Set<string>;
    labelSeqOk: boolean;
  }
  const drafts = new Map<string, Draft>();
  let wantModel: number | null = null;
  for (let r = 0; r < at.rowCount; r++) {
    if (fModel) {
      const m = fModel.int(r);
      if (wantModel === null) wantModel = m;
      if (m !== wantModel) continue;
    }
    const compId = normValue(fComp.str(r));
    // polymer rows: group_PDB when the file says; otherwise the residue name decides
    if (fGroup ? normValue(fGroup.str(r)) !== "ATOM" : !isPolymerComp(compId)) continue;
    const chain = normValue(fChain.str(r));
    const seq = fSeq.int(r);
    if (!chain || !Number.isFinite(seq)) continue;
    const ref: ResidueRef = { chain, seq, ins: fIns ? normValue(fIns.str(r)) : "" };
    const key = residueKey(ref);
    let d = drafts.get(chain);
    if (!d) {
      d = {
        chain,
        labelAsymId: fLabelAsym ? normValue(fLabelAsym.str(r)) || null : null,
        entityId: fEntity ? normValue(fEntity.str(r)) || null : null,
        residues: [],
        seen: new Set(),
        labelSeqOk: !!fLabelSeq,
      };
      drafts.set(chain, d);
    }
    if (d.seen.has(key)) continue;
    d.seen.add(key);
    const labelSeq = fLabelSeq ? fLabelSeq.int(r) : NaN;
    if (!Number.isFinite(labelSeq) || labelSeq < 1) d.labelSeqOk = false;
    d.residues.push({ ref, compId, labelSeq });
  }

  const chains: ChainSequence[] = [];
  for (const d of drafts.values()) {
    if (d.residues.length === 0) continue;
    // label_seq_id positions only when they are usable and strictly increasing
    const useLabel =
      d.labelSeqOk && d.residues.every((res, i) => i === 0 || res.labelSeq > d.residues[i - 1].labelSeq);
    const positions: SequencePosition[] = [];
    if (useLabel) {
      const length = d.residues[d.residues.length - 1].labelSeq;
      const byLabel = new Map(d.residues.map((res) => [res.labelSeq, res]));
      for (let pos = 1; pos <= length; pos++) {
        const res = byLabel.get(pos);
        positions.push(
          res
            ? { pos, compId: res.compId, letter: oneLetter(res.compId), ref: res.ref, observed: observedKeys ? observedKeys.has(residueKey(res.ref)) : true }
            : { pos, compId: "UNK", letter: "X", ref: null, observed: false },
        );
      }
    } else {
      d.residues.forEach((res, i) => {
        positions.push({
          pos: i + 1,
          compId: res.compId,
          letter: oneLetter(res.compId),
          ref: res.ref,
          observed: observedKeys ? observedKeys.has(residueKey(res.ref)) : true,
        });
      });
    }
    chains.push(finish(d.chain, d.labelAsymId, d.entityId, positions, "atom_site", useLabel));
  }
  return chains;
}

// the table alone: observed polymer residues (by residue name) in file order, 1..n
function fromTable(table: AtomTable): ChainSequence[] {
  const byChain = new Map<string, SequencePosition[]>();
  for (const res of table.residues) {
    if (!isPolymerComp(res.compId)) continue;
    const list = byChain.get(res.ref.chain) ?? [];
    list.push({ pos: list.length + 1, compId: res.compId, letter: oneLetter(res.compId), ref: res.ref, observed: true });
    byChain.set(res.ref.chain, list);
  }
  const chains: ChainSequence[] = [];
  for (const [chain, positions] of byChain) {
    if (positions.length < 2) continue; // a lone standard residue is a ligand-like fragment, not a chain
    chains.push(finish(chain, null, null, positions, "atom_site", false));
  }
  return chains;
}

function finish(
  chain: string,
  labelAsymId: string | null,
  entityId: string | null,
  positions: SequencePosition[],
  source: ChainSequence["source"],
  positionsAreLabelSeq: boolean,
): ChainSequence {
  const posByKey = new Map<string, number>();
  for (const p of positions) if (p.ref) posByKey.set(residueKey(p.ref), p.pos);
  return {
    chain,
    labelAsymId,
    entityId,
    length: positions.length,
    positions,
    letters: positions.map((p) => p.letter).join(""),
    source,
    positionsAreLabelSeq,
    posByKey,
  };
}

function spanFromRow(
  cat: MolCifCategory,
  r: number,
  model: SequenceModel,
): { chain: string; start: number; end: number } | null {
  const labelAsym = cat.getField("beg_label_asym_id");
  const authAsym = cat.getField("beg_auth_asym_id");
  const chain =
    (labelAsym ? model.authOfLabelAsym.get(normValue(labelAsym.str(r))) : undefined) ??
    (authAsym ? normValue(authAsym.str(r)) : "") ??
    "";
  const seq = model.byChain.get(chain);
  if (!seq) return null;
  const begL = cat.getField("beg_label_seq_id");
  const endL = cat.getField("end_label_seq_id");
  if (seq.positionsAreLabelSeq && begL && endL) {
    const start = begL.int(r);
    const end = endL.int(r);
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 1 && end >= start) {
      return { chain, start, end: Math.min(end, seq.length) };
    }
  }
  const begA = cat.getField("beg_auth_seq_id");
  const endA = cat.getField("end_auth_seq_id");
  const begIns = cat.getField("pdbx_beg_PDB_ins_code");
  const endIns = cat.getField("pdbx_end_PDB_ins_code");
  if (!begA || !endA) return null;
  const start = seq.posByKey.get(residueKey({ chain, seq: begA.int(r), ins: begIns ? normValue(begIns.str(r)) : "" }));
  const end = seq.posByKey.get(residueKey({ chain, seq: endA.int(r), ins: endIns ? normValue(endIns.str(r)) : "" }));
  if (start === undefined || end === undefined || end < start) return null;
  return { chain, start, end };
}
