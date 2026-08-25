import type { MolCifFile } from "./cif";
import { normValue } from "./cif";
import type { ResidueRef } from "./keys";
import { residueKey } from "./keys";

// A flat, typed-array view of one model's atom_site rows: the single structure
// every metric in this package computes from. Deliberately independent of Mol*'s
// Structure/Model objects so it can be built and tested headless, and later fed
// by other producers (e.g. an ETL that never touches Mol*).
export interface AtomTable {
  count: number;
  /** auth_asym_id per atom */
  chain: string[];
  /** auth_seq_id per atom */
  seq: Int32Array;
  /** pdbx_PDB_ins_code per atom, '' when none */
  ins: string[];
  /** auth_comp_id (label_comp_id fallback) per atom */
  compId: string[];
  /** label_atom_id per atom */
  atomName: string[];
  /** label_alt_id per atom, '' when none */
  altId: string[];
  /** type_symbol per atom, uppercased */
  element: string[];
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** occupancy per atom, 1 when the field is absent */
  occupancy: Float32Array;
  /** B_iso_or_equiv per atom, NaN when absent */
  bIso: Float32Array;
  /** the pdbx_PDB_model_num this table was built from (0 when the field is absent) */
  modelNum: number;
  /** residues in file order */
  residues: ResidueEntry[];
  /** residueKey(ref) to index into residues */
  residueIndex: Map<string, number>;
}

export interface ResidueEntry {
  ref: ResidueRef;
  compId: string;
  /** atom row indices belonging to this residue */
  rows: number[];
}

export function isHeavy(table: AtomTable, row: number): boolean {
  const e = table.element[row];
  return e !== "H" && e !== "D";
}

/** Protein backbone atom names, for classifying whether a split reaches the mainchain. */
export const BACKBONE_ATOMS = new Set(["N", "CA", "C", "O"]);

export interface BuildAtomTableOptions {
  blockIndex?: number;
  /** Which pdbx_PDB_model_num to keep; defaults to the first one encountered. */
  modelNum?: number;
}

// One pass over atom_site. Rows from other models are skipped; '.'/'?' normalize to ''.
export function buildAtomTable(file: MolCifFile, opts: BuildAtomTableOptions = {}): AtomTable | null {
  const block = file.blocks[opts.blockIndex ?? 0];
  const at = block?.categories["atom_site"];
  if (!at || at.rowCount === 0) return null;

  const f = (name: string) => at.getField(name);
  const fChain = f("auth_asym_id") ?? f("label_asym_id");
  const fSeq = f("auth_seq_id") ?? f("label_seq_id");
  const fIns = f("pdbx_PDB_ins_code");
  const fComp = f("auth_comp_id") ?? f("label_comp_id");
  const fAtom = f("label_atom_id") ?? f("auth_atom_id");
  const fAlt = f("label_alt_id");
  const fElem = f("type_symbol");
  const fX = f("Cartn_x");
  const fY = f("Cartn_y");
  const fZ = f("Cartn_z");
  const fOcc = f("occupancy");
  const fB = f("B_iso_or_equiv");
  const fModel = f("pdbx_PDB_model_num");
  if (!fChain || !fSeq || !fAtom || !fX || !fY || !fZ) return null;

  const n = at.rowCount;
  let wantModel = opts.modelNum ?? null;

  const chain: string[] = [];
  const seqArr: number[] = [];
  const ins: string[] = [];
  const compId: string[] = [];
  const atomName: string[] = [];
  const altId: string[] = [];
  const element: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const occ: number[] = [];
  const b: number[] = [];

  for (let r = 0; r < n; r++) {
    const m = fModel ? fModel.int(r) : 0;
    if (fModel && wantModel == null) wantModel = m;
    if (fModel && m !== wantModel) continue;
    const seq = fSeq.int(r);
    if (Number.isNaN(seq)) continue;
    chain.push(normValue(fChain.str(r)));
    seqArr.push(seq);
    ins.push(normValue(fIns?.str(r)));
    compId.push(normValue(fComp?.str(r)));
    atomName.push(normValue(fAtom.str(r)));
    altId.push(normValue(fAlt?.str(r)));
    element.push(normValue(fElem?.str(r)).toUpperCase());
    xs.push(fX.float(r));
    ys.push(fY.float(r));
    zs.push(fZ.float(r));
    const o = fOcc ? fOcc.float(r) : 1;
    occ.push(Number.isNaN(o) ? 1 : o);
    b.push(fB ? fB.float(r) : NaN);
  }

  const count = chain.length;
  if (count === 0) return null;

  const residues: ResidueEntry[] = [];
  const residueIndex = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const ref: ResidueRef = { chain: chain[i], seq: seqArr[i], ins: ins[i] };
    const key = residueKey(ref);
    let ri = residueIndex.get(key);
    if (ri === undefined) {
      ri = residues.length;
      residueIndex.set(key, ri);
      residues.push({ ref, compId: compId[i], rows: [] });
    }
    residues[ri].rows.push(i);
  }

  return {
    count,
    chain,
    seq: Int32Array.from(seqArr),
    ins,
    compId,
    atomName,
    altId,
    element,
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    z: Float64Array.from(zs),
    occupancy: Float32Array.from(occ),
    bIso: Float32Array.from(b),
    modelNum: wantModel ?? 0,
    residues,
    residueIndex,
  };
}
