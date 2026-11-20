// The hetcif categories (~/dev/hetcif): reader, worlds, row index and per-state map support.
// A subpath of its own (@dynamic-pdb/hetkit/hetcif): nothing under ./model or ./metrics
// imports from here, so a consumer that never asks for hetcif never loads it.
export {
  parseHetcif,
  components as hetcifComponents,
  worlds as hetcifWorlds,
  marginals as hetcifMarginals,
  topWorld as hetcifTopWorld,
  tableFor as hetcifTableFor,
  rowFor as hetcifRowFor,
  worldCount as hetcifWorldCount,
  stateRows as hetcifStateRows,
  buildRowIndex as buildHetcifRowIndex,
  hiddenRowsForWorld,
  rowsToSelectors,
} from "./model";
export type { HetcifModel, HetcifVariable, HetcifState, HetcifTable, HetcifTableRow, HetcifWorld, HetcifRowIndex } from "./model";
export { stateSupport } from "./support";
export type { StateSupportRow } from "./support";
