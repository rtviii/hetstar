import {
  DERIVED_METRICS,
  METRICS,
  STORED_METRICS,
  metricNeeds,
  type StoredMetricId,
  type Track,
} from "@dynamic-pdb/hetkit/metrics";
import type { TipContent } from "./ui";

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
  | "qscore"
  | "rscc-delta"
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
  "qscore",
  "rscc-delta",
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
  /** costly enough to be computed only when asked for, kept until erased */
  onRequest?: boolean;
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
  onRequest: boolean;
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
    onRequest: true,
    colors: LOW_IS_NOTABLE_RAMP,
  },
  qscore: {
    unionSplat: false,
    onRequest: true,
    colors: LOW_IS_NOTABLE_RAMP,
  },
  // red where the model agrees with the map less than the reference does, green where more
  "rscc-delta": {
    unionSplat: true,
    onRequest: true,
    colors: DIVERGING_RWG,
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
        onRequest: METRIC_LOOK[id].onRequest ?? false,
      },
    ];
  }),
) as Record<MetricId, MetricUi>;

// The metrics by concept, in the order every picker lists them. What a metric needs decides
// its group (the catalogue's stored values, a comparison across models, one against the
// reference, the maps); a metric of the model alone goes by what it describes.
const MODEL_CONCEPT: Partial<Record<MetricId, "motion" | "heterogeneity">> = {
  "motion-total": "motion",
  "motion-harmonic": "motion",
  "motion-discrete": "motion",
  "b-iso-mean": "motion",
  "ensemble-rmsf": "motion",
  "conformer-count": "heterogeneity",
  "occupancy-entropy": "heterogeneity",
  "bond-variability": "heterogeneity",
};

export interface MetricGroup {
  id: "motion" | "heterogeneity" | "across" | "reference" | "map" | "stored";
  title: string;
  ids: MetricId[];
}

export const METRIC_GROUPS: MetricGroup[] = (() => {
  const groups: MetricGroup[] = [
    { id: "motion", title: "Motion", ids: [] },
    { id: "heterogeneity", title: "Heterogeneity", ids: [] },
    { id: "across", title: "Across the compared models", ids: [] },
    { id: "reference", title: "Against the reference", ids: [] },
    { id: "map", title: "Fit to the map", ids: [] },
    { id: "stored", title: "Stored in the catalogue", ids: [] },
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const id of METRIC_ORDER) {
    const ui = METRIC_UI[id];
    const group: MetricGroup["id"] = ui.stored
      ? "stored"
      : ui.across
        ? "across"
        : ui.pair
          ? "reference"
          : ui.map
            ? "map"
            : (MODEL_CONCEPT[id] ?? "heterogeneity");
    byId.get(group)?.ids.push(id);
  }
  return groups.filter((group) => group.ids.length > 0);
})();

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

/** What the tooltips name besides the metric itself: both are the same for every model. */
export interface MetricProvenance {
  /** the model every pair metric compares against */
  referenceName: string | null;
  /** file name of the structure factors the maps are computed from */
  sfFile: string | null;
}

const MASK_NOTE =
  "Every point within 1.5 A of the residue's heavy atoms, in every conformer and every ensemble member. RSCC compares the map with the model's simulated density over these points.";
const ON_REQUEST_NOTE =
  "When asked for (seconds on a large ensemble), kept until erased. A change of the reference or of the map makes it stale.";
const MODEL_KEYED_NOTE = "By the model's own residues: swapping the model and its reference changes the result.";
const WEIGHTS_NOTE = "Altloc conformers count by occupancy, ensemble members equally.";
const FRAME_NOTE = "Atoms matched by residue and atom name in the crystal frame, without superposition.";
const NO_MAP_NOTE = "The model alone; no map involved.";

/** A metric explained in parts: what it is, how it is computed and from what. */
export function metricTooltip(id: MetricId, prov: MetricProvenance): TipContent {
  const registry = (rid: string) => METRICS.get(rid)?.description ?? "";
  const reference = { label: "reference", text: prov.referenceName ?? "none chosen" };
  const sf = prov.sfFile ?? "the entry's structure factors";
  const fofcMap = {
    label: "map",
    text: `mFo-DFc, client-side FFT of the coefficients in ${sf}. Phased by the deposited refinement, so biased toward the deposited model.`,
  };
  const twoFoFcMap = {
    label: "map",
    text: `2mFo-DFc, client-side FFT of the coefficients in ${sf}. Phased by the deposited model, so biased toward it.`,
  };
  const base = { title: metricLabel(id), unit: metricUnit(id) || undefined };
  switch (id) {
    case "motion-total":
    case "motion-harmonic":
    case "motion-discrete":
      return {
        ...base,
        is: registry(id),
        rows: [
          { label: "weights", text: WEIGHTS_NOTE },
          { label: "frame", text: FRAME_NOTE },
          { label: "inputs", text: NO_MAP_NOTE },
        ],
      };
    case "motion-delta":
      return {
        ...base,
        is: metricDescription(id),
        rows: [
          { label: "motion", text: registry("motion-total") },
          { label: "weights", text: WEIGHTS_NOTE },
          { label: "frame", text: FRAME_NOTE },
          reference,
        ],
      };
    case "motion-spread":
      return {
        ...base,
        is: metricDescription(id),
        rows: [
          { label: "motion", text: registry("motion-total") },
          { label: "compared", text: "Every model drawn in the main view and every model whose replica is on in the switchboard." },
          { label: "weights", text: WEIGHTS_NOTE },
          { label: "frame", text: FRAME_NOTE },
        ],
      };
    case "conformer-count":
    case "occupancy-entropy":
    case "b-iso-mean":
      return { ...base, is: registry(id), rows: [{ label: "inputs", text: NO_MAP_NOTE }] };
    case "bond-variability":
      return {
        ...base,
        is: metricDescription(id),
        rows: [
          {
            label: "bonds",
            text: "Mol*'s interaction engine at its default geometric cutoffs. It pairs only altloc-compatible atoms, so per-conformer bond sets come out of one pass.",
          },
          { label: "ensembles", text: "Variation across members is counted once the per-member pass finishes." },
          { label: "inputs", text: "The main view's model only." },
        ],
      };
    case "ensemble-rmsf":
      return {
        ...base,
        is: registry("ensemble-rmsf"),
        rows: [{ label: "inputs", text: "The model's MODEL frames; no map involved." }],
      };
    case "model-rmsd":
      return {
        ...base,
        is: registry("model-rmsd"),
        rows: [
          { label: "frame", text: "Same crystal frame, no superposition; no map involved." },
          { label: "keyed", text: MODEL_KEYED_NOTE },
          reference,
        ],
      };
    case "altloc-rmsf-delta":
      return {
        ...base,
        is: "Altloc RMSF of the model minus that of the reference, each computed on its own.",
        rows: [
          { label: "altloc rmsf", text: registry("altloc-rmsf") },
          { label: "sign", text: "Red where the model encodes more discrete heterogeneity than the reference." },
          { label: "inputs", text: "No map involved." },
          reference,
        ],
      };
    case "fofc-mean":
    case "fofc-peak":
      return {
        ...base,
        is: registry(id),
        rows: [{ label: "sampled", text: "At the model's heavy atoms only." }, fofcMap],
      };
    case "support-delta":
      return { ...base, is: registry("support-delta"), rows: [{ label: "keyed", text: MODEL_KEYED_NOTE }, reference, twoFoFcMap] };
    case "rscc-computed":
      return {
        ...base,
        is: registry(id),
        rows: [
          { label: "mask", text: MASK_NOTE },
          {
            label: "caveat",
            text: `Each model is scored over its own mask, so one with more states is scored over more points and reads lower for that reason alone. Do not compare it between models of different kinds; ${metricLabel("rscc-delta")} is for that.`,
          },
          {
            label: "size",
            text: "On 4N0X the 67-member ensemble's mean is 0.016 below the re-refined model's on own masks, 0.002 to 0.004 below on a common mask (one entry, 258 residues).",
          },
          {
            label: "checked",
            text: "Against the stored RSCC of two deposited models: 4N0X at 1.63 A (r 0.91, mean difference 0.016, 258 residues), 7APT at 1.13 A (r 0.74, mean difference 0.040, 127 residues). Other resolutions untested.",
          },
          { label: "limits", text: "No symmetry mates or bulk solvent in the simulated density: residues at lattice contacts read low." },
          { label: "computed", text: ON_REQUEST_NOTE },
          twoFoFcMap,
        ],
      };
    case "qscore":
      return {
        ...base,
        is: registry(id),
        rows: [
          { label: "sampled", text: "At the atom and on 20 shells out to 2 A, at the points no other atom comes nearer than 0.9 of the shell radius; the map values are correlated with the Gaussian's." },
          { label: "altlocs", text: "An atom of a conformer is shadowed by its own conformer and by unsplit atoms only. MapQ itself lets conformers shadow each other, so split residues differ from it." },
          { label: "ensemble", text: "Each member is scored alone; the residue takes the mean over the members." },
          { label: "crystal", text: "Symmetry copies of the model shadow too, built from the cell and space group in the entry's files; an entry that states neither is scored without them." },
          { label: "scope", text: "Polymer residues. Ligands, ions and waters shadow and are not scored." },
          {
            label: "caveat",
            text: "Defined for cryo-EM maps. Here every model is scored against the entry's one map, which is phased by the deposited model, and the score falls with resolution: compare the models of one entry, not entries.",
          },
          {
            label: "checked",
            text: "Against ChimeraX's QScore on the same map, two deposited models: 4N0X at 1.63 A (r 0.995, mean difference 0.008, 258 residues), 7APT at 1.13 A (r 0.984, mean difference 0.006, 127 residues). This one reads lower by that much. Not checked against MapQ itself, nor at lower resolution.",
          },
          {
            label: "reading",
            text: "Near its ceiling at these resolutions (mean 0.95 on both entries): it sets apart the poorly ordered residues and says little about the rest.",
          },
          { label: "computed", text: ON_REQUEST_NOTE },
          twoFoFcMap,
        ],
      };
    case "rscc-delta":
      return {
        ...base,
        is: registry(id),
        rows: [
          { label: "mask", text: MASK_NOTE },
          {
            label: "shared",
            text: "The union of the model's mask and the reference's, so each is marked down for density near the other's atoms that it leaves unexplained. Boxing other models does not change it.",
          },
          { label: "read", text: "The difference, not the two correlations: the 1.5 A radius was fitted on per-model masks." },
          { label: "sign", text: "Green where the model agrees with the map better, red where the reference does." },
          {
            label: "ensembles",
            text: "Provisional. An ensemble's mask covers every member, so the union is two to nine times a single model's mask on 4N0X (4,400 to 9,200 points against about 1,000 for surface side chains; one entry), and the score then describes the surroundings more than the residue.",
          },
          { label: "scope", text: "Polymer residues, matched by chain, number and insertion code; a residue one model lacks has no value." },
          { label: "computed", text: ON_REQUEST_NOTE },
          { label: "keyed", text: MODEL_KEYED_NOTE },
          reference,
          twoFoFcMap,
        ],
      };
    case "stored-rscc":
    case "stored-b-iso":
    case "stored-occupancy":
      return {
        ...base,
        is: metricDescription(id),
        rows: [{ label: "source", text: "The catalogue's residue data for the model. A model without stored rows leaves it unavailable." }],
      };
  }
}
