import { METRICS } from "@dynamic-pdb/hetkit/metrics";

// Metric metadata for the compare lab UI. Identity, labels, units and formula text come
// from hetkit's METRICS registry (the single source of truth — every label everywhere
// goes through metricLabel); this module only adds the rendering-side fields (ramps,
// input requirements) and the provenance-interpolated tooltip content. The one composite
// is altloc-rmsf-delta, which the app builds from two altloc-rmsf runs via trackDelta.

export type MetricId =
  | "conformer-count"
  | "occupancy-entropy"
  | "b-iso-mean"
  | "ensemble-rmsf"
  | "model-rmsd"
  | "altloc-rmsf-delta"
  | "fofc-mean"
  | "fofc-peak"
  | "support-delta";

// model-only metrics first (usable before any density is loaded), then pair, then map
export const METRIC_ORDER: MetricId[] = [
  "conformer-count",
  "occupancy-entropy",
  "b-iso-mean",
  "ensemble-rmsf",
  "model-rmsd",
  "altloc-rmsf-delta",
  "fofc-mean",
  "fofc-peak",
  "support-delta",
];

export interface MetricUi {
  /** needs model B */
  pair: boolean;
  /** needs the FFT'd maps */
  map: boolean;
  /** needs a multi-MODEL ensemble as model A */
  ensemble?: boolean;
  /** splat from the union of both models' atoms (pair metrics) vs model A only */
  unionSplat: boolean;
  /** domain [0, max] with a sequential ramp, vs symmetric diverging */
  sequential?: boolean;
  colors: number[];
}

const DIVERGING_BWR = [0x2166ac, 0xf7f7f7, 0xb2182b];
const DIVERGING_RWG = [0xbb3333, 0xf7f7f7, 0x33bb33];

const SEQUENTIAL_RAMP = [0xf0f0f0, 0xfdae61, 0xd7191c];

export const METRIC_UI: Record<MetricId, MetricUi> = {
  "conformer-count": {
    pair: false,
    map: false,
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "occupancy-entropy": {
    pair: false,
    map: false,
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "b-iso-mean": {
    pair: false,
    map: false,
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "ensemble-rmsf": {
    pair: false,
    map: false,
    ensemble: true,
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "model-rmsd": {
    pair: true,
    map: false,
    unionSplat: true,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "altloc-rmsf-delta": {
    pair: true,
    map: false,
    unionSplat: true,
    colors: DIVERGING_BWR,
  },
  "fofc-mean": {
    pair: false,
    map: true,
    unionSplat: false,
    colors: DIVERGING_RWG,
  },
  "fofc-peak": {
    pair: false,
    map: true,
    unionSplat: false,
    colors: DIVERGING_RWG,
  },
  "support-delta": {
    pair: true,
    map: true,
    unionSplat: true,
    colors: DIVERGING_BWR,
  },
};

export function metricLabel(id: MetricId): string {
  if (id === "altloc-rmsf-delta") return "Altloc RMSF delta";
  return METRICS.get(id)?.label ?? id;
}

export function metricUnit(id: MetricId): string {
  if (id === "altloc-rmsf-delta") return "A";
  return METRICS.get(id)?.unit ?? "";
}

export interface MetricProvenance {
  aUrl: string;
  bUrl: string;
  sfUrl: string;
  /** short slot naming shown in the toolbar and tooltips, e.g. "qFit multiconformer" */
  aDesc?: string;
  bDesc?: string;
}

const A_KEYED_NOTE = "Keyed by model A's residues: swapping which model is A changes the result.";

/** Tooltip content: exactly how the metric is computed and from which files. */
export function metricTooltip(id: MetricId, prov: MetricProvenance): { title: string; lines: string[] } {
  const registry = (rid: string) => METRICS.get(rid)?.description ?? "";
  const models = [
    `model A${prov.aDesc ? ` (${prov.aDesc})` : ""}: ${prov.aUrl}`,
    `model B${prov.bDesc ? ` (${prov.bDesc})` : ""}: ${prov.bUrl}`,
  ];
  const fofcMap = `map: client-side FFT of the mFo-DFc coefficients in ${prov.sfUrl}; phased by the deposited refinement, so biased toward the deposited model.`;
  const twoFoFcMap = `map: client-side FFT of the 2mFo-DFc coefficients in ${prov.sfUrl}; phased by the deposited model, so biased toward it.`;
  switch (id) {
    case "conformer-count":
    case "occupancy-entropy":
    case "b-iso-mean":
      return {
        title: metricLabel(id),
        lines: [registry(id), "Computed on model A only. No map involved.", models[0]],
      };
    case "ensemble-rmsf":
      return {
        title: metricLabel(id),
        lines: [
          registry("ensemble-rmsf"),
          "Computed across model A's MODEL frames. No map involved.",
          models[0],
        ],
      };
    case "model-rmsd":
      return {
        title: metricLabel(id),
        lines: [
          registry("model-rmsd"),
          "Same crystal frame, no superposition. No map involved.",
          A_KEYED_NOTE,
          ...models,
        ],
      };
    case "altloc-rmsf-delta":
      return {
        title: metricLabel(id),
        lines: [
          registry("altloc-rmsf"),
          "Computed independently per model, shown as A minus B: red where A encodes more discrete heterogeneity. No map involved.",
          ...models,
        ],
      };
    case "fofc-mean":
      return {
        title: metricLabel(id),
        lines: [registry("fofc-mean"), "Sampled at model A's heavy atoms only.", models[0], fofcMap],
      };
    case "fofc-peak":
      return {
        title: metricLabel(id),
        lines: [registry("fofc-peak"), "Sampled at model A's heavy atoms only.", models[0], fofcMap],
      };
    case "support-delta":
      return {
        title: metricLabel(id),
        lines: [registry("support-delta"), A_KEYED_NOTE, ...models, twoFoFcMap],
      };
  }
}
