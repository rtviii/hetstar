import {
  DERIVED_METRICS,
  METRICS,
  STORED_METRICS,
  metricNeeds,
  type StoredMetricId,
  type Track,
} from "@dynamic-pdb/hetkit/metrics";

// Metric metadata for the viewer UI. Identity, labels, units, formula text and input
// requirements come from hetkit (the METRICS registry for computed metrics, DERIVED_METRICS
// for comparisons of one metric across models, STORED_METRICS for the catalogue's stored
// per-residue values; every label everywhere goes through metricLabel); this module only adds the rendering-side fields (ramps, display domain)
// and the provenance-interpolated tooltip content. The one app-local metric is
// bond-variability, which needs the main view's interaction pass.

export type MetricId =
  | "motion-total"
  | "motion-harmonic"
  | "motion-discrete"
  | "motion-delta"
  | "motion-spread"
  | "conformer-count"
  | "occupancy-entropy"
  | "b-iso-mean"
  | "bond-variability"
  | "ensemble-rmsf"
  | "model-rmsd"
  | "altloc-rmsf-delta"
  | "fofc-mean"
  | "fofc-peak"
  | "support-delta"
  | "rscc-computed"
  | StoredMetricId;

// motion on the common scale first, then the other model-only metrics (usable before any
// density is loaded), then the comparisons, then map, then the catalogue's stored values
export const METRIC_ORDER: MetricId[] = [
  "motion-total",
  "motion-harmonic",
  "motion-discrete",
  "conformer-count",
  "occupancy-entropy",
  "b-iso-mean",
  "bond-variability",
  "ensemble-rmsf",
  "motion-spread",
  "motion-delta",
  "model-rmsd",
  "altloc-rmsf-delta",
  "fofc-mean",
  "fofc-peak",
  "support-delta",
  "rscc-computed",
  "stored-rscc",
  "stored-b-iso",
  "stored-occupancy",
];

interface MetricLook {
  /** splat from the union of both models' atoms (pair metrics) vs the model alone */
  unionSplat: boolean;
  /** domain [0, max] with a sequential ramp, vs the track's own domain */
  sequential?: boolean;
  /** a display domain that does not follow the data */
  fixedDomain?: [number, number];
  colors: number[];
}

export interface MetricUi extends MetricLook {
  /** needs a reference model */
  pair: boolean;
  /** needs the FFT'd maps */
  map: boolean;
  /** needs a multi-MODEL ensemble */
  ensemble: boolean;
  /** needs at least one other model to compare with */
  across: boolean;
  /** read from the catalogue's stored residue data, not computed */
  stored: boolean;
}

const DIVERGING_BWR = [0x2166ac, 0xf7f7f7, 0xb2182b];
const DIVERGING_RWG = [0xbb3333, 0xf7f7f7, 0x33bb33];

const SEQUENTIAL_RAMP = [0xf0f0f0, 0xfdae61, 0xd7191c];
// low is the notable end (poor correlation, partial occupancy)
const LOW_IS_NOTABLE_RAMP = [0xd7191c, 0xfdae61, 0xf0f0f0];

const METRIC_LOOK: Record<MetricId, MetricLook> = {
  "motion-total": {
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "motion-harmonic": {
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "motion-discrete": {
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "motion-delta": {
    unionSplat: true,
    colors: DIVERGING_BWR,
  },
  "motion-spread": {
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "conformer-count": {
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "occupancy-entropy": {
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "b-iso-mean": {
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "bond-variability": {
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "ensemble-rmsf": {
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "model-rmsd": {
    unionSplat: true,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "altloc-rmsf-delta": {
    unionSplat: true,
    colors: DIVERGING_BWR,
  },
  "fofc-mean": {
    unionSplat: false,
    colors: DIVERGING_RWG,
  },
  "fofc-peak": {
    unionSplat: false,
    colors: DIVERGING_RWG,
  },
  "support-delta": {
    unionSplat: true,
    colors: DIVERGING_BWR,
  },
  "rscc-computed": {
    unionSplat: false,
    colors: LOW_IS_NOTABLE_RAMP,
  },
  "stored-rscc": {
    unionSplat: false,
    colors: LOW_IS_NOTABLE_RAMP,
  },
  "stored-b-iso": {
    unionSplat: false,
    sequential: true,
    colors: SEQUENTIAL_RAMP,
  },
  "stored-occupancy": {
    unionSplat: false,
    fixedDomain: [0, 1],
    colors: LOW_IS_NOTABLE_RAMP,
  },
};

export const METRIC_UI = Object.fromEntries(
  METRIC_ORDER.map((id): [MetricId, MetricUi] => {
    const needs = metricNeeds(id);
    const derived = DERIVED_METRICS.get(id);
    return [
      id,
      {
        ...METRIC_LOOK[id],
        pair: needs?.reference ?? derived?.combine === "delta",
        map: !!needs?.map,
        ensemble: needs?.ensemble ?? false,
        across: derived?.combine === "spread",
        stored: STORED_METRICS.has(id),
      },
    ];
  }),
) as Record<MetricId, MetricUi>;

/** The domain a metric is drawn on: lanes, the 3D paint and the switchboard boxes agree on it. */
export function displayDomain(id: MetricId, track: Track): [number, number] {
  const ui = METRIC_UI[id];
  const [low, high] = ui.fixedDomain ?? (ui.sequential ? [0, track.domain[1]] : track.domain);
  return high > low ? [low, high] : [low, low + 1];
}

// app-local metrics (computed in the app, not registered in hetkit)
const LOCAL_LABELS: Partial<Record<MetricId, string>> = {
  "bond-variability": "Differential bonds",
};
const LOCAL_UNITS: Partial<Record<MetricId, string>> = {
  "bond-variability": "bonds",
};
const LOCAL_DESCRIPTIONS: Partial<Record<MetricId, string>> = {
  "bond-variability":
    "Non-covalent bonds at the residue that are not invariant: formed under only some altloc conformers, or present in only some ensemble members.",
};

function described(id: MetricId): { label: string; description: string; unit?: string } | undefined {
  return METRICS.get(id) ?? DERIVED_METRICS.get(id) ?? STORED_METRICS.get(id);
}

export function metricLabel(id: MetricId): string {
  return LOCAL_LABELS[id] ?? described(id)?.label ?? id;
}

export function metricUnit(id: MetricId): string {
  return LOCAL_UNITS[id] ?? described(id)?.unit ?? "";
}

export function metricDescription(id: MetricId): string {
  return LOCAL_DESCRIPTIONS[id] ?? described(id)?.description ?? "";
}

export interface MetricProvenance {
  aUrl: string;
  bUrl: string;
  sfUrl: string;
  /** short slot naming shown in the toolbar and tooltips, e.g. "qFit multiconformer" */
  aDesc?: string;
  bDesc?: string;
}

const MODEL_KEYED_NOTE = "Keyed by this model's residues: swapping the model and its reference changes the result.";

/** Tooltip content: exactly how the metric is computed and from which files. */
export function metricTooltip(id: MetricId, prov: MetricProvenance): { title: string; lines: string[] } {
  const registry = (rid: string) => METRICS.get(rid)?.description ?? "";
  const models = [
    `this model${prov.aDesc ? ` (${prov.aDesc})` : ""}: ${prov.aUrl}`,
    `reference model${prov.bDesc ? ` (${prov.bDesc})` : ""}: ${prov.bUrl}`,
  ];
  const fofcMap = `map: client-side FFT of the mFo-DFc coefficients in ${prov.sfUrl}; phased by the deposited refinement, so biased toward the deposited model.`;
  const twoFoFcMap = `map: client-side FFT of the 2mFo-DFc coefficients in ${prov.sfUrl}; phased by the deposited model, so biased toward it.`;
  const motionNote =
    "Altloc conformers count by occupancy and ensemble members equally; atoms are matched by residue and atom name in the crystal frame, without superposition. No map involved.";
  switch (id) {
    case "motion-total":
    case "motion-harmonic":
    case "motion-discrete":
      return {
        title: metricLabel(id),
        lines: [registry(id), motionNote, models[0]],
      };
    case "motion-delta":
      return {
        title: metricLabel(id),
        lines: [metricDescription(id), registry("motion-total"), motionNote, ...models],
      };
    case "motion-spread":
      return {
        title: metricLabel(id),
        lines: [
          metricDescription(id),
          registry("motion-total"),
          "Compared: the two models of the main view and every model that has a box in the switchboard.",
          motionNote,
        ],
      };
    case "conformer-count":
    case "occupancy-entropy":
    case "b-iso-mean":
      return {
        title: metricLabel(id),
        lines: [registry(id), "Computed on this model alone. No map involved.", models[0]],
      };
    case "bond-variability":
      return {
        title: metricLabel(id),
        lines: [
          metricDescription(id),
          "Bonds come from Mol*'s interaction engine (geometric cutoffs at its default thresholds) on this model; the engine pairs only altloc-compatible atoms, so per-conformer bond sets fall out of one pass. Ensemble variation is counted once the per-member pass finishes.",
          models[0],
        ],
      };
    case "ensemble-rmsf":
      return {
        title: metricLabel(id),
        lines: [
          registry("ensemble-rmsf"),
          "Computed across this model's MODEL frames. No map involved.",
          models[0],
        ],
      };
    case "model-rmsd":
      return {
        title: metricLabel(id),
        lines: [
          registry("model-rmsd"),
          "Same crystal frame, no superposition. No map involved.",
          MODEL_KEYED_NOTE,
          ...models,
        ],
      };
    case "altloc-rmsf-delta":
      return {
        title: metricLabel(id),
        lines: [
          registry("altloc-rmsf"),
          "Computed independently per model, shown as this model minus the reference: red where this model encodes more discrete heterogeneity. No map involved.",
          ...models,
        ],
      };
    case "fofc-mean":
      return {
        title: metricLabel(id),
        lines: [registry("fofc-mean"), "Sampled at this model's heavy atoms only.", models[0], fofcMap],
      };
    case "fofc-peak":
      return {
        title: metricLabel(id),
        lines: [registry("fofc-peak"), "Sampled at this model's heavy atoms only.", models[0], fofcMap],
      };
    case "support-delta":
      return {
        title: metricLabel(id),
        lines: [registry("support-delta"), MODEL_KEYED_NOTE, ...models, twoFoFcMap],
      };
    case "rscc-computed":
      return {
        title: metricLabel(id),
        lines: [
          registry(id),
          "Checked against the stored RSCC of two deposited models: 4N0X at 1.63 A (r 0.91, mean difference 0.016, 258 residues) and 7APT at 1.13 A (r 0.74, mean difference 0.040, 127 residues). Other resolutions are untested.",
          "No symmetry mates or bulk solvent in the simulated density, so residues at lattice contacts read low.",
          models[0],
          twoFoFcMap,
        ],
      };
    case "stored-rscc":
    case "stored-b-iso":
    case "stored-occupancy":
      return {
        title: metricLabel(id),
        lines: [
          metricDescription(id),
          "Read from the catalogue's residue data for this model; models without stored rows leave it disabled.",
          models[0],
        ],
      };
  }
}
