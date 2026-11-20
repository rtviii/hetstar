"use client";
import { useMemo } from "react";
import { isPolymerComp, residueKey, type AtomTable } from "@dynamic-pdb/hetkit/model";
import {
  buildHetcifRowIndex,
  hetcifMarginals,
  hetcifStateRows,
  hetcifTopWorld,
  hiddenRowsForWorld,
  parseHetcif,
  rowsToSelectors,
  type HetcifModel,
  type HetcifRowIndex,
} from "@dynamic-pdb/hetkit/hetcif";
import type { ConformerOverride, ResidueRange } from "../lib/molstar/conformers";
import type { AltGroupSelector } from "../lib/molstar/queries";
import type { HetstarModule, ModuleInput, ModuleOutput, ModulePanelContext } from "../module";
import WorldPanel from "./WorldPanel";

// The hetcif module (~/dev/hetcif): everything the viewer does because a file carries
// _hetcif_* categories. A file names the variables its altlocs belong to and the joint over
// them; the viewer shows one world: the most probable by default, with the user's
// per-variable or per-group overrides. Residues covered by a variable take their visibility
// from the world; the viewer's per-residue collapse keeps handling the rest.
//
// The viewer reaches this only through the hetcif preset (preset.ts) and the module
// interface (../module.ts). New hetcif features start here; when one needs a place in the
// viewer that ModuleOutput does not offer yet, add a field there.

/** the module's state: variable id -> state id the user chose; empty = the top world */
type WorldChoice = Record<string, string>;
const NO_CHOICE: WorldChoice = {};

/**
 * The polymer residues any variable covers, as contiguous per-chain ranges in table order:
 * the extent of the stick overlay under a cartoon. Waters, ligands and ions a variable covers
 * are left out: their components are ball-and-stick under every polymer type already.
 */
export function worldStickRanges(table: AtomTable, index: HetcifRowIndex): ResidueRange[] {
  const ranges: ResidueRange[] = [];
  let lastKey = "";
  for (let i = 0; i < table.count; i++) {
    const key = `${table.chain[i]}|${table.seq[i]}|${table.ins[i]}`;
    if (key === lastKey) continue;
    lastKey = key;
    if (!index.byResidue.has(key) || !isPolymerComp(table.compId[i])) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.chain === table.chain[i] && table.seq[i] === last.to + 1) last.to = table.seq[i];
    else if (last && last.chain === table.chain[i] && table.seq[i] === last.to) continue; // insertion-code copy
    else ranges.push({ chain: table.chain[i], from: table.seq[i], to: table.seq[i] });
  }
  return ranges;
}

interface WorldSectionProps extends ModulePanelContext {
  model: HetcifModel;
  table: AtomTable;
  index: HetcifRowIndex;
  marginals: Map<string, number>;
  top: WorldChoice;
  world: WorldChoice;
  choice: WorldChoice;
  setChoice: (update: (prev: WorldChoice) => WorldChoice) => void;
}

/** the world panel in the selection flyout, with the variables the selection touches */
function WorldSection({ model, table, index, marginals, top, world, choice, setChoice, selection, densitySampler, fofcSampler, disabled }: WorldSectionProps) {
  // variables touching the selected residues, in file order
  const selectedVariables = useMemo(() => {
    if (!selection.length) return [];
    const out: string[] = [];
    for (const res of table.residues) {
      const inSel = selection.some((r) => r.chain === res.ref.chain && res.ref.seq >= r.from && res.ref.seq <= r.to);
      if (!inSel) continue;
      for (const vid of index.byResidue.get(residueKey(res.ref)) ?? []) if (!out.includes(vid)) out.push(vid);
    }
    return out;
  }, [index, table, selection]);
  const overridden = useMemo(() => new Set(Object.keys(choice).filter((v) => choice[v] !== top[v])), [choice, top]);
  return (
    <WorldPanel
      model={model}
      table={table}
      index={index}
      marginals={marginals}
      world={world}
      overridden={overridden}
      selectedVariables={selectedVariables}
      densitySampler={densitySampler}
      fofcSampler={fofcSampler}
      disabled={disabled}
      onChoose={(v, st) => setChoice((prev) => ({ ...prev, [v]: st }))}
      onChooseMany={(states) => setChoice((prev) => ({ ...prev, ...states }))}
      onReset={() => setChoice(() => NO_CHOICE)}
    />
  );
}

function useHetcifModule({ file, table, state, setState }: ModuleInput): ModuleOutput | null {
  const choice = (state as WorldChoice | undefined) ?? NO_CHOICE;
  const model = useMemo(() => (file ? parseHetcif(file) : null), [file]);
  const index = useMemo(() => (model && table ? buildHetcifRowIndex(table, model) : null), [model, table]);
  const top = useMemo(() => (model ? hetcifTopWorld(model) : null), [model]);
  const marginals = useMemo(() => (model ? hetcifMarginals(model) : null), [model]);
  const world = useMemo(() => (top ? { ...top, ...choice } : null), [top, choice]);

  const conformers = useMemo<ConformerOverride | undefined>(() => {
    if (!model || !index || !table || !world) return undefined;
    const hidden = rowsToSelectors(table, hiddenRowsForWorld(index, world));
    // the visible atoms of variables the user moved, by altloc letter, for the accent overpaint
    const accent = new Map<string, AltGroupSelector[]>();
    for (const vid of Object.keys(choice)) {
      if (!model.variables.has(vid)) continue;
      const st = world[vid];
      const rows = hetcifStateRows(index, vid).get(st) ?? [];
      if (!rows.length) continue;
      const list = accent.get(st) ?? [];
      list.push(...rowsToSelectors(table, rows));
      accent.set(st, list);
    }
    return { hidden, covered: new Set(index.byResidue.keys()), accent };
  }, [model, index, table, world, choice]);

  const stickRanges = useMemo(() => (index && table ? worldStickRanges(table, index) : undefined), [index, table]);

  return useMemo<ModuleOutput | null>(() => {
    if (!model || !index || !table || !marginals || !top || !world) return null;
    const setChoice = (update: (prev: WorldChoice) => WorldChoice) =>
      setState((prev: unknown) => update((prev as WorldChoice | undefined) ?? NO_CHOICE));
    return {
      conformers,
      stickRanges,
      statesPanelWidth: 480,
      statesPanel: (context) => (
        <WorldSection
          {...context}
          model={model}
          table={table}
          index={index}
          marginals={marginals}
          top={top}
          world={world}
          choice={choice}
          setChoice={setChoice}
        />
      ),
    };
  }, [model, index, table, marginals, top, world, choice, conformers, stickRanges, setState]);
}

export const hetcifModule: HetstarModule = { id: "hetcif", useModule: useHetcifModule };
