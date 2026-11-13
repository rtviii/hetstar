"use client";
import { useMemo } from "react";
import type { Track } from "@dynamic-pdb/hetkit/metrics";
import type { AtomTable } from "@dynamic-pdb/hetkit/model";
import { METRIC_UI, type MetricId } from "../components/compare/metrics";
import { memberTablesOf } from "../lib/lab/model-bundle";
import {
  createMetricEngine,
  type MapSamplers,
  type MetricContext,
  type MetricOutcome,
  type ModelInputs,
  type StoredTracks,
} from "../lib/lab/metric-engine";
import type { ModelBundles } from "./useModelBundles";

/** the model the main view holds: its frame on screen and what only the main view computes */
export interface PrimaryModel {
  modelId: string;
  table: AtomTable;
  /** one table per ensemble member; empty for single-model files */
  members: readonly AtomTable[];
  local: Partial<Record<MetricId, Track | string>>;
}

export interface ModelMetrics {
  /** null when the metric can be produced for the model; otherwise why not. Computes nothing. */
  unavailable(modelId: string, metricId: MetricId): string | null;
  /** the metric of a model: against the reference model where it compares two, across the
   * compared models where it compares them all */
  resolve(modelId: string, metricId: MetricId): MetricOutcome;
}

const NOT_LOADED = "model not loaded";
const IS_REFERENCE = "this is the reference model";

/** Metrics of any model of the loaded entry, from whatever is on hand: the main view's
 * model, the shared bundle cache, the entry's maps and the catalogue's stored data. */
export function useModelMetrics(args: {
  entryId: string | null;
  /** the entry comes from the catalogue, so its models may carry stored residue data */
  catalogued: boolean;
  bundles: ModelBundles;
  stored: ReadonlyMap<string, StoredTracks | null>;
  primary: PrimaryModel | null;
  /** the model every pair metric compares against */
  referenceId: string | null;
  /** the models compared with one another; those not loaded yet are left out */
  comparedIds: readonly string[];
  maps: MapSamplers;
  /** resolution limit of the entry's data in A */
  resolution: number | null;
}): ModelMetrics {
  const { entryId, catalogued, bundles, stored, primary, referenceId, comparedIds, maps, resolution } = args;
  // a fresh engine per entry, so tracks of the previous entry are not kept alive
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const engine = useMemo(() => createMetricEngine(), [entryId]);
  const bundleStates = bundles.states;

  return useMemo(() => {
    const inputsFor = (modelId: string): ModelInputs | null => {
      const storedTracks = catalogued ? stored.get(modelId) : null;
      if (primary && primary.modelId === modelId) {
        const members = primary.members;
        return {
          modelId,
          table: primary.table,
          ensemble: members.length ? { count: members.length, key: members, tables: () => members } : null,
          stored: storedTracks,
          local: primary.local,
        };
      }
      const state = bundleStates.get(modelId);
      if (state?.status !== "ready") return null;
      const bundle = state.bundle;
      return {
        modelId,
        table: bundle.table,
        ensemble: bundle.ensemble
          ? { count: bundle.ensemble.modelCount, key: bundle.file, tables: () => memberTablesOf(bundle) }
          : null,
        stored: storedTracks,
      };
    };
    const compared = comparedIds.map(inputsFor).filter((inputs): inputs is ModelInputs => inputs !== null);
    const contextFor = (modelId: string): MetricContext => ({
      reference: referenceId && referenceId !== modelId ? inputsFor(referenceId) : null,
      compared,
      maps,
      resolution,
    });

    return {
      unavailable(modelId, metricId) {
        if (METRIC_UI[metricId].pair && referenceId === modelId) return IS_REFERENCE;
        const model = inputsFor(modelId);
        return model ? engine.unavailable(metricId, model, contextFor(modelId)) : NOT_LOADED;
      },
      resolve(modelId, metricId) {
        if (METRIC_UI[metricId].pair && referenceId === modelId) return IS_REFERENCE;
        const model = inputsFor(modelId);
        return model ? engine.resolve(metricId, model, contextFor(modelId)) : NOT_LOADED;
      },
    };
  }, [engine, catalogued, bundleStates, stored, primary, referenceId, comparedIds, maps, resolution]);
}
