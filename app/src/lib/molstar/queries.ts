import {
  QueryContext,
  Structure,
  StructureElement,
  StructureSelection,
} from "molstar/lib/mol-model/structure";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { compile } from "molstar/lib/mol-script/runtime/query/compiler";

// MolScript query builders + execution — the bridge between "a chain/residue id"
// and a Mol* loci you can highlight/focus. Ported from fend_tubulinxyz/queries.ts;
// fully generic (no tubulin assumptions).

export const buildChainQuery = (chainId: string) =>
  MS.struct.generator.atomGroups({
    "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), chainId]),
  });

export const buildMultiChainQuery = (chainIds: string[]) =>
  MS.struct.generator.atomGroups({
    "chain-test": MS.core.set.has([MS.set(...chainIds), MS.ammp("auth_asym_id")]),
  });

export const buildResidueQuery = (chainId: string, startResidue: number, endResidue?: number) => {
  const residueTest =
    endResidue !== undefined
      ? MS.core.rel.inRange([MS.ammp("auth_seq_id"), startResidue, endResidue])
      : MS.core.rel.eq([MS.ammp("auth_seq_id"), startResidue]);
  return MS.struct.generator.atomGroups({
    "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), chainId]),
    "residue-test": residueTest,
  });
};

export const buildMultiResidueQuery = (chainId: string, authSeqIds: number[]) =>
  MS.struct.generator.atomGroups({
    "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), chainId]),
    "residue-test": MS.core.set.has([MS.set(...authSeqIds), MS.ammp("auth_seq_id")]),
  });

// A single atom: chain + residue + atom name (optionally disambiguated by altloc).
export const buildAtomQuery = (
  chainId: string,
  authSeqId: number,
  atomId: string,
  altId?: string,
) => {
  const atomNameTest = MS.core.rel.eq([MS.ammp("label_atom_id"), atomId]);
  return MS.struct.generator.atomGroups({
    "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), chainId]),
    "residue-test": MS.core.rel.eq([MS.ammp("auth_seq_id"), authSeqId]),
    "atom-test": altId
      ? MS.core.logic.and([atomNameTest, MS.core.rel.eq([MS.ammp("label_alt_id"), altId])])
      : atomNameTest,
  });
};

// All residues of a TLS group: one chain, a union of auth_seq_id ranges.
export const buildTlsGroupExpression = (chain: string, ranges: { beg: number; end: number }[]) => {
  const inRange = ranges.map((r) => MS.core.rel.inRange([MS.ammp("auth_seq_id"), r.beg, r.end]));
  const residueTest = inRange.length === 1 ? inRange[0] : MS.core.logic.or(inRange);
  return MS.struct.generator.atomGroups({
    "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), chain]),
    "residue-test": residueTest,
  });
};

// A heterogeneity-network membership selector (one _pdbx_alt_groups row): chain + residue range +
// altloc, optionally a single atom name. Structurally matches het.ts's AltSelector.
export interface AltGroupSelector {
  chain: string;
  seqStart: number;
  seqEnd: number;
  altId: string;
  atomId: string | null;
}

const altGroupAtomGroups = (s: AltGroupSelector) => {
  const altTest = MS.core.rel.eq([MS.ammp("label_alt_id"), s.altId]);
  return MS.struct.generator.atomGroups({
    "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), s.chain]),
    "residue-test":
      s.seqStart === s.seqEnd
        ? MS.core.rel.eq([MS.ammp("auth_seq_id"), s.seqStart])
        : MS.core.rel.inRange([MS.ammp("auth_seq_id"), s.seqStart, s.seqEnd]),
    // label_atom_id null ('.' in the file) selects the whole residue range; otherwise one atom.
    "atom-test": s.atomId
      ? MS.core.logic.and([MS.core.rel.eq([MS.ammp("label_atom_id"), s.atomId]), altTest])
      : altTest,
  });
};

// Union of a network's membership selectors -> the atoms that constitute that network/state.
export const buildAltGroupExpression = (selectors: AltGroupSelector[]) => {
  const groups = selectors.map(altGroupAtomGroups);
  return groups.length === 1 ? groups[0] : MS.struct.combinator.merge(groups);
};

// The constant "base" part: every atom not claimed by any network selector (empty in files that
// list only the alternate atoms; the single-conformer scaffold in a full structure).
export const buildHetBaseExpression = (allSelectors: AltGroupSelector[]) =>
  MS.struct.modifier.exceptBy({
    0: MS.struct.generator.all(),
    by: buildAltGroupExpression(allSelectors),
  });

export const buildEntityQuery = (entityId: string) =>
  MS.struct.generator.atomGroups({
    "chain-test": MS.core.rel.eq([MS.ammp("label_entity_id"), entityId]),
  });

// All instances of a chemical component (e.g. every HEM ligand), by residue name.
export const buildComponentQuery = (compId: string) =>
  MS.struct.generator.atomGroups({
    "residue-test": MS.core.rel.eq([MS.ammp("label_comp_id"), compId]),
  });

// Two residues (the partners of a struct_conn bond / contact), possibly on different chains.
export const buildBondQuery = (
  chain1: string,
  seq1: number,
  chain2: string,
  seq2: number,
) => {
  const residue = (chain: string, seq: number) =>
    MS.core.logic.and([
      MS.core.rel.eq([MS.ammp("auth_asym_id"), chain]),
      MS.core.rel.eq([MS.ammp("auth_seq_id"), seq]),
    ]);
  return MS.struct.generator.atomGroups({
    "atom-test": MS.core.logic.or([residue(chain1, seq1), residue(chain2, seq2)]),
  });
};

// Exactly the two ATOMS a struct_conn row names — not their whole residues, which is the
// difference that matters for an alternate-specific bond: Thr26's carbonyl oxygen reaches the ion
// four times, once per letter, and highlighting the residue would light all four at once.
export interface BondEnd {
  chain: string;
  seq: number;
  atomId: string;
  altId: string | null;
}

export const buildBondAtomsExpression = (a: BondEnd, b: BondEnd) => {
  const end = (e: BondEnd) => {
    const tests = [
      MS.core.rel.eq([MS.ammp("auth_asym_id"), e.chain]),
      MS.core.rel.eq([MS.ammp("auth_seq_id"), e.seq]),
      MS.core.rel.eq([MS.ammp("label_atom_id"), e.atomId]),
    ];
    // No letter on the row means "whichever copy of this atom exists" — a single-conformer
    // partner, like the ion itself.
    if (e.altId) tests.push(MS.core.rel.eq([MS.ammp("label_alt_id"), e.altId]));
    return MS.core.logic.and(tests);
  };
  return MS.struct.generator.atomGroups({
    "atom-test": MS.core.logic.or([end(a), end(b)]),
  });
};

export const buildSurroundingsQuery = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseQuery: any,
  radius = 5,
) =>
  MS.struct.modifier.includeSurroundings({
    0: baseQuery,
    radius,
    "as-whole-residues": true,
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const executeQuery = (query: any, structure: Structure): StructureElement.Loci | null => {
  const compiled = compile(query);
  const selection = compiled(new QueryContext(structure));
  if (StructureSelection.isEmpty(selection)) return null;
  return StructureSelection.toLociWithSourceUnits(selection);
};

export const structureToLoci = (structure: Structure): StructureElement.Loci =>
  Structure.toStructureElementLoci(structure);
