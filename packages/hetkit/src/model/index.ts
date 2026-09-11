import { summarizeAltlocs, type AltlocSummary } from "./altloc";
import { buildAtomTable, type AtomTable } from "./atoms";
import { asMolCifFile, type MolCifFile } from "./cif";
import { summarizeEnsemble, type EnsembleSummary } from "./ensemble";
import { parseHeterogeneity, type HetModel } from "./het-ext";
import { summarizeMotion, type MotionSummary } from "./motion";

// One call from parsed CIF to a normalized description of everything this file
// says about heterogeneity, across all four kinds the viewer targets.
export interface HeterogeneityDescription {
  /** flat atom view of the (first) model; null when the file has no atom_site */
  table: AtomTable | null;
  /** null when the file is single-conformer */
  altlocs: AltlocSummary | null;
  /** null unless the file is multi-MODEL */
  ensemble: EnsembleSummary | null;
  /** TLS groups, aniso presence, B range */
  motion: MotionSummary;
  /** networks/states from the extension categories; null when absent (all of today's corpus) */
  extensions: HetModel | null;
}

export function describeHeterogeneity(raw: unknown, opts: { blockIndex?: number } = {}): HeterogeneityDescription {
  const file: MolCifFile = asMolCifFile(raw);
  const blockIndex = opts.blockIndex ?? 0;
  const table = buildAtomTable(file, { blockIndex });
  return {
    table,
    altlocs: table ? summarizeAltlocs(table) : null,
    ensemble: summarizeEnsemble(file, blockIndex),
    motion: summarizeMotion(file, table, blockIndex),
    extensions: parseHeterogeneity(file, table, blockIndex),
  };
}

export { residueKey, atomKey } from "./keys";
export type { ResidueRef } from "./keys";
export { asMolCifFile, normValue } from "./cif";
export type { MolCifFile, MolCifBlock, MolCifCategory, MolCifField } from "./cif";
export { parseCifText } from "./parse";
export { buildAtomTable, isHeavy, BACKBONE_ATOMS } from "./atoms";
export type { AtomTable, ResidueEntry, BuildAtomTableOptions } from "./atoms";
export { summarizeAltlocs, OCC_SUM_TOL } from "./altloc";
export type { AltlocSummary, AltlocResidue } from "./altloc";
export { summarizeEnsemble } from "./ensemble";
export type { EnsembleSummary } from "./ensemble";
export { summarizeMotion, parseTlsGroups } from "./motion";
export type { MotionSummary, TlsGroup, Vec3Like } from "./motion";
export { parseHeterogeneity, matchesSelector, selectorsFor } from "./het-ext";
export type {
  HetModel,
  HetNetwork,
  HetState,
  HetBond,
  HetBondEnd,
  HetExclusion,
  AltSelector,
  AtomKey,
  StateSource,
} from "./het-ext";
export { describeEntry } from "./entry";
export type { EntryDescription, EntryEntity } from "./entry";
export {
  buildSequenceModel,
  positionOf,
  refAt,
  unobservedSpans,
  readSecondaryStructure,
  oneLetter,
  isPolymerComp,
  THREE_TO_ONE,
} from "./sequence";
export type {
  SequenceModel,
  ChainSequence,
  SequencePosition,
  Span,
  SecondarySpan,
  BuildSequenceOptions,
} from "./sequence";
