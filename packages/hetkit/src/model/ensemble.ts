import type { MolCifFile } from "./cif";

// Multi-MODEL (ensemble) content: NMR bundles, ensemble refinement output.
// The qFit corpus is single-model, so this is null for most Dynamic PDB entries.
export interface EnsembleSummary {
  modelCount: number;
  modelNums: number[];
}

export function summarizeEnsemble(file: MolCifFile, blockIndex = 0): EnsembleSummary | null {
  const at = file.blocks[blockIndex]?.categories["atom_site"];
  const fModel = at?.getField("pdbx_PDB_model_num");
  if (!at || !fModel) return null;
  const nums = new Set<number>();
  for (let r = 0; r < at.rowCount; r++) {
    const m = fModel.int(r);
    if (!Number.isNaN(m)) nums.add(m);
  }
  if (nums.size <= 1) return null;
  return { modelCount: nums.size, modelNums: [...nums].sort((a, b) => a - b) };
}
