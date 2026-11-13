import {
  combineDerived,
  DERIVED_METRICS,
  metricNeeds,
  resolveMetric,
  STORED_METRICS,
  type MapSampler,
  type StoredMetricId,
  type Track,
} from "@dynamic-pdb/hetkit/metrics";
import type { AtomTable } from "@dynamic-pdb/hetkit/model";
import type { MetricId } from "../../components/compare/metrics";

// "Metric X of model M, optionally against reference R": the one place the lanes, the
// density paint and the switchboard boxes get their tracks from. A metric comes from one
// of four producers: the main view (what only it can compute), hetkit (computed from the
// model's atoms and the entry's maps), a comparison of one hetkit metric across models
// (against the reference, or across the compared models), or the catalogue's stored
// residue data.

export type StoredTracks = Partial<Record<StoredMetricId, Track>>;

export interface ModelInputs {
  modelId: string;
  /** the model's atoms; the frame on screen for an ensemble in the main view */
  table: AtomTable;
  /** null for single-model files; `key` changes when the member tables would */
  ensemble: { count: number; key: unknown; tables(): readonly AtomTable[] } | null;
  /** stored residue data as tracks: undefined while it is on its way, null when the model has none */
  stored: StoredTracks | null | undefined;
  /** metrics only the main view produces for this model: the track, or why it is not there yet */
  local?: Partial<Record<MetricId, Track | string>>;
}

export interface MapSamplers {
  twoFoFc: MapSampler | null;
  foFc: MapSampler | null;
}

/** what a metric of one model may be compared with */
export interface MetricContext {
  /** the model pair metrics compare against; null when there is none (or the model is it) */
  reference: ModelInputs | null;
  /** the loaded models being compared with one another, the model itself included or not */
  compared: readonly ModelInputs[];
  maps: MapSamplers;
  /** resolution limit of the entry's data in A; null when the entry does not state it */
  resolution: number | null;
}

/** a track, or the reason the metric is unavailable */
export type MetricOutcome = Track | string;

export interface MetricEngine {
  /** null when the metric can be produced; computes nothing */
  unavailable(id: MetricId, model: ModelInputs, context: MetricContext): string | null;
  resolve(id: MetricId, model: ModelInputs, context: MetricContext): MetricOutcome;
}

const NO_REFERENCE = "needs a reference model";
const NOTHING_TO_COMPARE = "needs another model to compare with";

function samplerFor(id: MetricId, maps: MapSamplers): MapSampler | null {
  const map = metricNeeds(id)?.map;
  if (!map) return null;
  return map === "fofc" ? maps.foFc : maps.twoFoFc;
}

function othersCompared(model: ModelInputs, context: MetricContext): ModelInputs[] {
  return context.compared.filter((other) => other.modelId !== model.modelId);
}

function unavailable(id: MetricId, model: ModelInputs, context: MetricContext): string | null {
  if (STORED_METRICS.has(id)) {
    if (model.stored === undefined) return "loading stored data";
    return model.stored?.[id as StoredMetricId] ? null : "no stored data for this model";
  }
  const derived = DERIVED_METRICS.get(id);
  if (derived) {
    const base = derived.of as MetricId;
    const own = unavailable(base, model, context);
    if (own) return own;
    if (derived.combine === "delta") {
      if (!context.reference) return NO_REFERENCE;
      return unavailable(base, context.reference, context);
    }
    return othersCompared(model, context).some((other) => !unavailable(base, other, context)) ? null : NOTHING_TO_COMPARE;
  }
  const needs = metricNeeds(id);
  if (!needs) {
    const local = model.local?.[id];
    if (local === undefined) return "main view only";
    return typeof local === "string" ? local : null;
  }
  if (needs.reference && !context.reference) return NO_REFERENCE;
  if (needs.ensemble && (model.ensemble?.count ?? 0) < 2) return "needs a multi-model ensemble";
  if (needs.map && !samplerFor(id, context.maps)) return "enables with the density";
  return null;
}

export function createMetricEngine(): MetricEngine {
  // computed tracks, kept while the inputs they were computed from are the same objects
  const cache = new Map<string, { inputs: readonly unknown[]; track: Track }>();
  const cached = (key: string, inputs: readonly unknown[], compute: () => Track | null): MetricOutcome => {
    const hit = cache.get(key);
    if (hit && hit.inputs.length === inputs.length && hit.inputs.every((input, i) => input === inputs[i])) return hit.track;
    const track = compute();
    if (!track) return "unavailable";
    cache.set(key, { inputs, track });
    return track;
  };

  const resolve = (id: MetricId, model: ModelInputs, context: MetricContext): MetricOutcome => {
    const reason = unavailable(id, model, context);
    if (reason) return reason;
    if (STORED_METRICS.has(id)) return model.stored?.[id as StoredMetricId] ?? "no stored data for this model";

    const derived = DERIVED_METRICS.get(id);
    if (derived) {
      const base = derived.of as MetricId;
      const own = resolve(base, model, context);
      if (typeof own === "string") return own;
      const others: Track[] = [];
      const against = derived.combine === "delta" ? (context.reference ? [context.reference] : []) : othersCompared(model, context);
      for (const other of against) {
        const track = resolve(base, other, context);
        if (typeof track !== "string") others.push(track);
      }
      return cached(`${model.modelId}|${id}`, [own, ...others], () => combineDerived(derived, own, others));
    }

    const needs = metricNeeds(id);
    if (!needs) return model.local?.[id] ?? "main view only";

    const overMembers = needs.ensemble || (needs.states && !!model.ensemble);
    const referenceTable = needs.reference ? (context.reference?.table ?? null) : null;
    const sampler = samplerFor(id, context.maps);
    const inputs = [overMembers ? model.ensemble?.key : model.table, referenceTable, sampler];
    const cacheKey = `${model.modelId}|${id}|${needs.reference ? (context.reference?.modelId ?? "") : ""}`;
    return cached(cacheKey, inputs, () => {
      const resolved = resolveMetric(id, {
        table: model.table,
        reference: referenceTable,
        members: overMembers ? model.ensemble?.tables() : undefined,
        maps: context.maps,
        resolution: context.resolution,
      });
      return "track" in resolved ? resolved.track : null;
    });
  };

  return { unavailable, resolve };
}
