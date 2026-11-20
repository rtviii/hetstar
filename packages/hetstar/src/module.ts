import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { MapSampler } from "@dynamic-pdb/hetkit/metrics";
import type { AtomTable, MolCifFile } from "@dynamic-pdb/hetkit/model";
import type { ConformerOverride, ResidueRange } from "./lib/molstar/conformers";

// A module is optional behaviour a preset brings to the viewer (presets/types.ts). The viewer
// knows this interface and nothing about any module by name: it calls the module's hook with
// the main model, and wires whatever comes back into places it already has (the conformer
// collapse, a stick overlay under a cartoon, the states section of the selection flyout).
// A preset without a module runs none of this, and the package's main entry imports no
// module, so a consumer that never asks for one never loads its code.
//
// To give a module a new place in the viewer, add a field to ModuleOutput and read it where
// the viewer draws that place. Do not branch on a module's id in the viewer.

export interface ModuleInput {
  /** the main view's model, parsed; null until it is loaded */
  file: MolCifFile | null;
  table: AtomTable | null;
  /**
   * The module's own state for this model, opaque to the viewer, which keeps it the way it
   * keeps the expanded conformers: undefined on a new entry and on "reset all", put aside
   * when the main view leaves a model and given back when it returns.
   */
  state: unknown;
  setState: Dispatch<SetStateAction<unknown>>;
}

/** what the viewer hands a module's panel when it draws it */
export interface ModulePanelContext {
  /** the current selection as residue ranges */
  selection: ResidueRange[];
  /** 2mFo-DFc and Fo-Fc samplers in sigma units; null until density is ready */
  densitySampler: MapSampler | null;
  fofcSampler: MapSampler | null;
  /** true while the main model is not on screen yet */
  disabled: boolean;
}

export interface ModuleOutput {
  /** which conformers show on the residues the module covers, instead of the per-residue
   * top-occupancy collapse (lib/molstar/conformers.ts) */
  conformers?: ConformerOverride;
  /** polymer residues to draw as thin ball-and-stick while the polymer is a trace, where the
   * collapse layers leave the polymer alone and `conformers` would move nothing on screen */
  stickRanges?: ResidueRange[];
  /** replaces the conformer-state buttons at the foot of the selection flyout */
  statesPanel?: (context: ModulePanelContext) => ReactNode;
  /** the selection flyout's width while statesPanel is present, px */
  statesPanelWidth?: number;
}

export interface HetstarModule {
  id: string;
  /** a React hook: called on every render of the viewer, in the same place. Returns null when
   * the module has nothing to say about this file. */
  useModule: (input: ModuleInput) => ModuleOutput | null;
}

/** the hook the viewer calls when the preset brings no module */
export function useNoModule(): null {
  return null;
}
