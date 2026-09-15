import {
  QueryContext,
  Structure,
  StructureElement,
  StructureSelection,
} from "molstar/lib/mol-model/structure";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { compile } from "molstar/lib/mol-script/runtime/query/compiler";

// MolScript query builders + execution: the bridge between "a chain/residue id"
// and a Mol* loci you can highlight/focus.

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

// An altloc membership selector: chain + residue range + altloc letter, optionally a single
// atom name. The conformer layer uses these to address (and hide) individual conformers.
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

// Union of selectors -> the atoms they name.
export const buildAltGroupExpression = (selectors: AltGroupSelector[]) => {
  const groups = selectors.map(altGroupAtomGroups);
  return groups.length === 1 ? groups[0] : MS.struct.combinator.merge(groups);
};

// Union of arbitrary atomGroups expressions (e.g. residue queries across chains).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mergeExpressions = (exprs: any[]) =>
  exprs.length === 1 ? exprs[0] : MS.struct.combinator.merge(exprs);

// base minus by (set difference) — e.g. a selection minus its hidden conformer atoms.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const exceptExpression = (base: any, by: any) =>
  MS.struct.modifier.exceptBy({ 0: base, by });

// All instances of a chemical component (e.g. every HEM ligand), by residue name.
export const buildComponentQuery = (compId: string) =>
  MS.struct.generator.atomGroups({
    "residue-test": MS.core.rel.eq([MS.ammp("label_comp_id"), compId]),
  });

// Exactly the named water residues (chain + auth seq, every insertion-code copy), limited to
// the given altloc letters ("" = blank). The comp test guards against an auth chain+seq
// collision with a polymer residue; comps is passed in so this module stays free of lab imports.
export const buildWatersQuery = (
  waters: readonly { chain: string; seq: number; alts: string[] }[],
  comps: string[],
) =>
  mergeExpressions(
    waters.map((w) =>
      MS.struct.generator.atomGroups({
        "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), w.chain]),
        "residue-test": MS.core.logic.and([
          MS.core.rel.eq([MS.ammp("auth_seq_id"), w.seq]),
          MS.core.set.has([MS.set(...comps), MS.ammp("label_comp_id")]),
        ]),
        "atom-test": MS.core.set.has([MS.set(...w.alts), MS.ammp("label_alt_id")]),
      }),
    ),
  );

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const executeQuery = (query: any, structure: Structure): StructureElement.Loci | null => {
  const compiled = compile(query);
  const selection = compiled(new QueryContext(structure));
  if (StructureSelection.isEmpty(selection)) return null;
  return StructureSelection.toLociWithSourceUnits(selection);
};

// Residue/range loci with a compiled-query cache. Compilation is structure-independent
// and drag/hover over the lanes asks for the same few keys at pointer rate, so the
// MolScript compile (the expensive half of executeQuery) runs once per distinct range.
const residueQueryCache = new Map<string, (ctx: QueryContext) => StructureSelection>();

export const residueLoci = (
  structure: Structure,
  chainId: string,
  from: number,
  to: number = from,
): StructureElement.Loci | null => {
  const key = `${chainId}|${from}|${to}`;
  let compiled = residueQueryCache.get(key);
  if (!compiled) {
    if (residueQueryCache.size >= 512) residueQueryCache.clear();
    compiled = compile<StructureSelection>(buildResidueQuery(chainId, from, to === from ? undefined : to));
    residueQueryCache.set(key, compiled);
  }
  const selection = compiled(new QueryContext(structure));
  if (StructureSelection.isEmpty(selection)) return null;
  return StructureSelection.toLociWithSourceUnits(selection);
};

export const structureToLoci = (structure: Structure): StructureElement.Loci =>
  Structure.toStructureElementLoci(structure);
