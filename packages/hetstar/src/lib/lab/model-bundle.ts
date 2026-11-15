import {
  buildAtomTable,
  parseCifText,
  pdbToCifText,
  summarizeAltlocs,
  summarizeEnsemble,
  type AltlocSummary,
  type AtomTable,
  type EnsembleSummary,
  type MolCifFile,
} from "@dynamic-pdb/hetkit/model";
import { toFetchableUrl } from "../dpdb/client";
import type { LoadableModel } from "../dpdb/types";
import { planConformers, type ConformerPlan } from "../molstar/conformers";
import { compSplitFromTable, type CompSplit } from "../molstar/repstyle";

// Everything the viewer derives from one model file, built once and shared: the main view
// reads the primary pair's bundles, a switchboard box reads the bundle of whichever model
// it shows.

export interface ModelBundle {
  model: LoadableModel;
  /** mmCIF text (a PDB-format model is converted on arrival) */
  text: string;
  file: MolCifFile;
  /** the first MODEL's atoms */
  table: AtomTable;
  split: CompSplit;
  /** null for single-model files */
  ensemble: EnsembleSummary | null;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

// hetkit and Mol* both read CIF text, so a PDB-format model is converted on arrival
export async function fetchModelText(model: LoadableModel): Promise<string> {
  const text = await fetchText(toFetchableUrl(model.url));
  return model.format === "pdb" ? pdbToCifText(text, model.title) : text;
}

export async function bundleFromText(model: LoadableModel, text: string): Promise<ModelBundle> {
  const file = await parseCifText(text);
  const table = buildAtomTable(file);
  if (!table) throw new Error(`"${model.title}" has no atoms`);
  return { model, text, file, table, split: compSplitFromTable(table), ensemble: summarizeEnsemble(file) };
}

export async function loadModelBundle(model: LoadableModel): Promise<ModelBundle> {
  return bundleFromText(model, await fetchModelText(model));
}

const altlocCache = new WeakMap<AtomTable, AltlocSummary | null>();
const planCache = new WeakMap<AtomTable, ConformerPlan>();

/** the altloc census of a model's first frame (null: no altlocs to count), computed once per table */
export function altlocSummaryOf(bundle: ModelBundle): AltlocSummary | null {
  if (!altlocCache.has(bundle.table)) altlocCache.set(bundle.table, summarizeAltlocs(bundle.table));
  return altlocCache.get(bundle.table) ?? null;
}

/** which conformer each split residue of a model collapses to, computed once per table */
export function conformerPlanOf(bundle: ModelBundle): ConformerPlan {
  let plan = planCache.get(bundle.table);
  if (!plan) {
    plan = planConformers(altlocSummaryOf(bundle));
    planCache.set(bundle.table, plan);
  }
  return plan;
}

const memberTableCache = new WeakMap<MolCifFile, AtomTable[]>();

/** one AtomTable per MODEL of an ensemble file (empty for single-model files), built once per file */
export function memberTablesOfFile(file: MolCifFile, ensemble: EnsembleSummary | null): AtomTable[] {
  if (!ensemble) return [];
  let tables = memberTableCache.get(file);
  if (!tables) {
    tables = [];
    for (const modelNum of ensemble.modelNums) {
      const table = buildAtomTable(file, { modelNum });
      if (table) tables.push(table);
    }
    memberTableCache.set(file, tables);
  }
  return tables;
}

export function memberTablesOf(bundle: ModelBundle): AtomTable[] {
  return memberTablesOfFile(bundle.file, bundle.ensemble);
}
