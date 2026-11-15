"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@dynamic-pdb/hetkit/metrics";
import type { AtomTable } from "@dynamic-pdb/hetkit/model";
import { METRIC_UI, type MetricId } from "../components/compare/metrics";
import { afterPaint } from "../lib/lab/after-paint";
import { crystalOf, symmetryOperatorsAround } from "../lib/molstar/crystal";
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
  /** where a metric that is computed on request stands for a model; null for every other metric */
  requested(modelId: string, metricId: MetricId): OnRequestState | null;
  /** compute an on-request metric of a model (again, if it is there); returns at once */
  compute(modelId: string, metricId: MetricId): void;
  erase(modelId: string, metricId: MetricId): void;
  /** a loaded model as the frames it is scored from (one table, or one per ensemble
   * member); null while it is not loaded */
  statesOf(modelId: string): readonly AtomTable[] | null;
}

export type OnRequestState =
  | { status: "blocked"; reason: string }
  | { status: "absent" }
  | { status: "computing" }
  | { status: "ready" };

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

  // on-request metrics: which are being computed, and a count that moves when one lands or goes
  const [computing, setComputing] = useState<ReadonlySet<string>>(() => new Set());
  const [revision, setRevision] = useState(0);

  const access = useMemo(() => {
    // the models of an entry share one crystal: read from the first file that states it
    let crystal: ReturnType<typeof crystalOf> = null;
    for (const state of bundleStates.values()) {
      if (state.status !== "ready") continue;
      crystal = crystalOf(state.bundle.file);
      if (crystal) break;
    }
    // keyed on the model's first frame, so stepping through an ensemble keeps the list
    const symmetryFor = (modelId: string, fallback: AtomTable) => {
      if (!crystal) return null;
      const state = bundleStates.get(modelId);
      return symmetryOperatorsAround(crystal, state?.status === "ready" ? state.bundle.table : fallback);
    };
    const inputsFor = (modelId: string): ModelInputs | null => {
      const storedTracks = catalogued ? stored.get(modelId) : null;
      if (primary && primary.modelId === modelId) {
        const members = primary.members;
        return {
          modelId,
          table: primary.table,
          ensemble: members.length ? { count: members.length, key: members, tables: () => members } : null,
          symmetry: symmetryFor(modelId, primary.table),
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
        symmetry: symmetryFor(modelId, bundle.table),
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

    return { inputsFor, contextFor };
  }, [catalogued, bundleStates, stored, primary, referenceId, comparedIds, maps, resolution]);

  const accessRef = useRef(access);
  useEffect(() => {
    accessRef.current = access;
  }, [access]);

  const compute = useCallback(
    (modelId: string, metricId: MetricId) => {
      const key = `${modelId}|${metricId}`;
      setComputing((previous) => new Set(previous).add(key));
      afterPaint(() => {
        const model = accessRef.current.inputsFor(modelId);
        if (model) engine.compute(metricId, model, accessRef.current.contextFor(modelId));
        setComputing((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
        setRevision((count) => count + 1);
      });
    },
    [engine],
  );

  const erase = useCallback(
    (modelId: string, metricId: MetricId) => {
      engine.erase(metricId, modelId);
      setRevision((count) => count + 1);
    },
    [engine],
  );

  return useMemo<ModelMetrics>(() => {
    const { inputsFor, contextFor } = access;
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
      requested(modelId, metricId) {
        if (!METRIC_UI[metricId].onRequest) return null;
        if (METRIC_UI[metricId].pair && referenceId === modelId) return { status: "blocked", reason: IS_REFERENCE };
        const model = inputsFor(modelId);
        if (!model) return { status: "blocked", reason: NOT_LOADED };
        const context = contextFor(modelId);
        const reason = engine.blocked(metricId, model, context);
        if (reason) return { status: "blocked", reason };
        if (computing.has(`${modelId}|${metricId}`)) return { status: "computing" };
        return { status: engine.unavailable(metricId, model, context) ? "absent" : "ready" };
      },
      compute,
      erase,
      statesOf(modelId) {
        const model = inputsFor(modelId);
        if (!model) return null;
        return model.ensemble ? model.ensemble.tables() : [model.table];
      },
    };
    // `revision` is read by nothing: it makes a new object when a kept track lands or goes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, access, referenceId, computing, revision, compute, erase]);
}
