import type { AtomTable } from "../model/atoms";
import type { MapSampler } from "./map";
import { METRICS, type MapKind } from "./registry";
import type { Track } from "./tracks";

// One question, one answer: "metric X of this model, optionally against a reference".
// The caller hands over whatever inputs it holds; the registry says which of them the
// metric needs, and a missing one comes back as a reason instead of a track.

export interface MetricSources {
  /** the model the metric describes (one MODEL frame of an ensemble) */
  table: AtomTable;
  /** the model the pair metrics compare against */
  reference?: AtomTable | null;
  /** one table per ensemble member */
  members?: readonly AtomTable[];
  maps?: { twoFoFc?: MapSampler | null; foFc?: MapSampler | null };
  /** resolution limit of the data behind the maps, in A */
  resolution?: number | null;
}

/** used where the entry does not state its resolution */
export const FALLBACK_RESOLUTION = 2;

export type MetricMissing = "reference" | "ensemble" | "map" | "unknown";

export interface MetricNeeds {
  reference: boolean;
  /** computable only for a multi-member ensemble */
  ensemble: boolean;
  /** reads every member of an ensemble when there are any, and the model alone otherwise */
  states: boolean;
  map: MapKind | null;
}

export type MetricResolution = { track: Track } | { missing: MetricMissing };

/** what a registered metric requires beyond the model itself; null for an unknown id */
export function metricNeeds(id: string): MetricNeeds | null {
  const metric = METRICS.get(id);
  if (!metric) return null;
  const usesMap = metric.input === "model-map" || metric.input === "model-pair-map" || metric.input === "states-map";
  return {
    reference: metric.input === "model-pair" || metric.input === "model-pair-map",
    ensemble: metric.input === "model-list",
    states: metric.input === "states" || metric.input === "states-map",
    map: usesMap ? (metric.map ?? "2fofc") : null,
  };
}

export function resolveMetric(id: string, sources: MetricSources): MetricResolution {
  const metric = METRICS.get(id);
  if (!metric) return { missing: "unknown" };
  const { table, reference, members, maps } = sources;
  const sample = (metric.map ?? "2fofc") === "fofc" ? maps?.foFc : maps?.twoFoFc;
  switch (metric.input) {
    case "model":
      return { track: metric.compute({ kind: "model", model: table }) };
    case "model-pair":
      if (!reference) return { missing: "reference" };
      return { track: metric.compute({ kind: "model-pair", a: table, b: reference }) };
    case "model-map":
      if (!sample) return { missing: "map" };
      return { track: metric.compute({ kind: "model-map", model: table, sample }) };
    case "model-pair-map":
      if (!reference) return { missing: "reference" };
      if (!sample) return { missing: "map" };
      return { track: metric.compute({ kind: "model-pair-map", a: table, b: reference, sample }) };
    case "model-list":
      if (!members || members.length < 2) return { missing: "ensemble" };
      return { track: metric.compute({ kind: "model-list", models: [...members] }) };
    case "states":
      return { track: metric.compute({ kind: "states", model: table, members: members ? [...members] : [] }) };
    case "states-map":
      if (!sample) return { missing: "map" };
      return {
        track: metric.compute({
          kind: "states-map",
          model: table,
          members: members ? [...members] : [],
          sample,
          resolution: sources.resolution ?? FALLBACK_RESOLUTION,
        }),
      };
  }
}
