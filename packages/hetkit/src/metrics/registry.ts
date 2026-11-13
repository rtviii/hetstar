import type { AtomTable } from "../model/atoms";
import { altlocRmsf, conformerCount, occupancyEntropy } from "./altloc-metrics";
import { bIsoMean } from "./bfactor";
import { ensembleRmsf } from "./ensemble-rmsf";
import type { MapSampler } from "./map";
import { mapSupportDelta, mapValueTracks } from "./map";
import { motionTracks } from "./motion";
import { modelRmsd } from "./rmsd";
import { realSpaceCorrelation } from "./rscc";
import type { Level, Track } from "./tracks";
import { trackDelta } from "./tracks";

// What a metric needs. Maps enter as a plain (x, y, z) => value sampler (sigma units,
// NaN for "no data") rather than a Mol* Volume, keeping this layer headless; the viewer
// side builds the sampler from whatever volume it holds.
export type MetricInput =
  | { kind: "model"; model: AtomTable }
  | { kind: "model-pair"; a: AtomTable; b: AtomTable }
  | { kind: "model-map"; model: AtomTable; sample: MapSampler }
  | { kind: "model-pair-map"; a: AtomTable; b: AtomTable; sample: MapSampler }
  | { kind: "model-list"; models: AtomTable[] }
  /** a model as its coordinate frames: `members` holds one table per ensemble member, empty for a single model */
  | { kind: "states"; model: AtomTable; members: AtomTable[] }
  /** the same, against a map from data that reach `resolution` (A) */
  | { kind: "states-map"; model: AtomTable; members: AtomTable[]; sample: MapSampler; resolution: number };

/** which of an entry's maps a map metric samples */
export type MapKind = "2fofc" | "fofc";

export interface MetricDescriptor<K extends MetricInput["kind"] = MetricInput["kind"]> {
  id: string;
  label: string;
  description: string;
  level: Level;
  unit?: string;
  input: K;
  /** the map a map metric samples */
  map?: MapKind;
  domainHint?: [number, number];
  compute(input: Extract<MetricInput, { kind: K }>): Track;
}

export type AnyMetric =
  | MetricDescriptor<"model">
  | MetricDescriptor<"model-pair">
  | MetricDescriptor<"model-map">
  | MetricDescriptor<"model-pair-map">
  | MetricDescriptor<"model-list">
  | MetricDescriptor<"states">
  | MetricDescriptor<"states-map">;

function statesOf(input: { model: AtomTable; members: AtomTable[] }): AtomTable[] {
  return input.members.length >= 2 ? input.members : [input.model];
}

const list: AnyMetric[] = [
  {
    id: "conformer-count",
    label: "Conformers",
    description: "Distinct alternate-conformer letters on the residue (1 when unsplit).",
    level: "residue",
    input: "model",
    compute: (i) => conformerCount(i.model),
  },
  {
    id: "occupancy-entropy",
    label: "Occupancy entropy",
    description: "Shannon entropy (bits) of the residue's conformer occupancies.",
    level: "residue",
    unit: "bits",
    input: "model",
    compute: (i) => occupancyEntropy(i.model),
  },
  {
    id: "altloc-rmsf",
    label: "Altloc RMSF",
    description:
      "Occupancy-weighted RMS fluctuation of split atoms about their weighted centroid, averaged over the residue.",
    level: "residue",
    unit: "A",
    input: "model",
    compute: (i) => altlocRmsf(i.model),
  },
  {
    id: "b-iso-mean",
    label: "Mean B",
    description: "Occupancy-weighted mean isotropic B over the residue's heavy atoms.",
    level: "residue",
    unit: "A^2",
    input: "model",
    compute: (i) => bIsoMean(i.model),
  },
  {
    id: "motion-total",
    label: "Motion (total)",
    description:
      "RMS displacement of the residue's heavy atoms that the model describes: the part from its B-factors and the spread across its states (altloc conformers or ensemble members), added in quadrature.",
    level: "residue",
    unit: "A",
    input: "states",
    compute: (i) => motionTracks(statesOf(i)).total,
  },
  {
    id: "motion-harmonic",
    label: "Motion (from B)",
    description:
      "RMS displacement implied by the B-factors, sqrt(3B / 8 pi^2), with B averaged by occupancy over the residue's heavy atoms.",
    level: "residue",
    unit: "A",
    input: "states",
    compute: (i) => motionTracks(statesOf(i)).harmonic,
  },
  {
    id: "motion-discrete",
    label: "Motion (across states)",
    description:
      "RMS spread of each heavy atom about its mean position across the model's states: altloc conformers weighted by occupancy, or ensemble members. Unsplit atoms count as zero. No superposition.",
    level: "residue",
    unit: "A",
    input: "states",
    compute: (i) => motionTracks(statesOf(i)).discrete,
  },
  {
    id: "ensemble-rmsf",
    label: "Ensemble RMSF",
    description:
      "RMS fluctuation of each heavy atom about its mean position across the ensemble's MODEL frames, averaged over the residue. No superposition: valid in a shared crystal frame (ensemble refinement); inflated for unsuperposed NMR-style bundles.",
    level: "residue",
    unit: "A",
    input: "model-list",
    compute: (i) => ensembleRmsf(i.models),
  },
  {
    id: "model-rmsd",
    label: "Model displacement",
    description:
      "Per-residue displacement between two models sharing a frame (occupancy-weighted centroids of shared heavy atom names).",
    level: "residue",
    unit: "A",
    input: "model-pair",
    compute: (i) => modelRmsd(i.a, i.b),
  },
  {
    id: "altloc-rmsf-delta",
    label: "Altloc RMSF delta",
    description:
      "Altloc RMSF of the model minus that of the reference model, per residue. Positive: the model encodes more discrete heterogeneity.",
    level: "residue",
    unit: "A",
    input: "model-pair",
    compute: (i) => trackDelta(altlocRmsf(i.a), altlocRmsf(i.b), { metricId: "altloc-rmsf-delta" }),
  },
  {
    id: "fofc-mean",
    label: "Fo-Fc mean",
    description:
      "Occupancy-weighted mean of the Fo-Fc difference map (sigma units) at the residue's heavy atoms: signed unexplained density.",
    level: "residue",
    unit: "sigma",
    input: "model-map",
    map: "fofc",
    compute: (i) => mapValueTracks(i.model, i.sample, { idPrefix: "fofc" }).mean,
  },
  {
    id: "fofc-peak",
    label: "Fo-Fc peak",
    description:
      "Signed value of the largest-magnitude Fo-Fc sample (sigma units) among the residue's heavy atoms.",
    level: "residue",
    unit: "sigma",
    input: "model-map",
    map: "fofc",
    compute: (i) => mapValueTracks(i.model, i.sample, { idPrefix: "fofc" }).peak,
  },
  {
    id: "rscc-computed",
    label: "RSCC (computed)",
    description:
      "Correlation between the 2Fo-Fc map and a density simulated from the model (one Gaussian per atom, from its B-factor and blurred for the resolution), over the points within 1.5 A of the residue's atoms. An approximation of the validation report's RSCC, not that number.",
    level: "residue",
    input: "states-map",
    map: "2fofc",
    compute: (i) => realSpaceCorrelation(statesOf(i), i.sample, { resolution: i.resolution }),
  },
  {
    id: "support-delta",
    label: "Density support delta",
    description:
      "Occupancy-weighted mean 2Fo-Fc (sigma units) at the model's heavy atoms minus at the reference model's, per residue. Positive: the model is better supported. Support is measured in the deposited map, whose phases favor the deposited model.",
    level: "residue",
    unit: "sigma",
    input: "model-pair-map",
    map: "2fofc",
    compute: (i) => mapSupportDelta(i.a, i.b, i.sample),
  },
];

export const METRICS: ReadonlyMap<string, AnyMetric> = new Map(list.map((m) => [m.id, m]));
