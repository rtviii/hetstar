import type { AtomTable } from "../model/atoms";
import { altlocRmsf, conformerCount, occupancyEntropy } from "./altloc-metrics";
import { bIsoMean } from "./bfactor";
import type { MapSampler } from "./map";
import { mapSupportDelta, mapValueTracks } from "./map";
import { modelRmsd } from "./rmsd";
import type { Level, Track } from "./tracks";

// What a metric needs. Maps enter as a plain (x, y, z) => value sampler (sigma units,
// NaN for "no data") rather than a Mol* Volume, keeping this layer headless; the viewer
// side builds the sampler from whatever volume it holds.
export type MetricInput =
  | { kind: "model"; model: AtomTable }
  | { kind: "model-pair"; a: AtomTable; b: AtomTable }
  | { kind: "model-map"; model: AtomTable; sample: MapSampler }
  | { kind: "model-pair-map"; a: AtomTable; b: AtomTable; sample: MapSampler }
  | { kind: "model-list"; models: AtomTable[] };

export interface MetricDescriptor<K extends MetricInput["kind"] = MetricInput["kind"]> {
  id: string;
  label: string;
  description: string;
  level: Level;
  unit?: string;
  input: K;
  domainHint?: [number, number];
  compute(input: Extract<MetricInput, { kind: K }>): Track;
}

export type AnyMetric =
  | MetricDescriptor<"model">
  | MetricDescriptor<"model-pair">
  | MetricDescriptor<"model-map">
  | MetricDescriptor<"model-pair-map">
  | MetricDescriptor<"model-list">;

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
    id: "model-rmsd",
    label: "Model vs model",
    description:
      "Per-residue displacement between two models sharing a frame (occupancy-weighted centroids of shared heavy atom names).",
    level: "residue",
    unit: "A",
    input: "model-pair",
    compute: (i) => modelRmsd(i.a, i.b),
  },
  {
    id: "fofc-mean",
    label: "Fo-Fc mean",
    description:
      "Occupancy-weighted mean of the Fo-Fc difference map (sigma units) at the residue's heavy atoms: signed unexplained density.",
    level: "residue",
    unit: "sigma",
    input: "model-map",
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
    compute: (i) => mapValueTracks(i.model, i.sample, { idPrefix: "fofc" }).peak,
  },
  {
    id: "support-delta",
    label: "Density support delta",
    description:
      "Occupancy-weighted mean 2Fo-Fc (sigma units) at model A's heavy atoms minus at model B's, per residue. Positive: A better supported. Support is measured in the deposited map, whose phases favor the deposited model.",
    level: "residue",
    unit: "sigma",
    input: "model-pair-map",
    compute: (i) => mapSupportDelta(i.a, i.b, i.sample),
  },
];

export const METRICS: ReadonlyMap<string, AnyMetric> = new Map(list.map((m) => [m.id, m]));

export { makeTrack, scopeTrack, trackDelta, trackFromJSON, trackToJSON } from "./tracks";
export type { Level, Track, TrackJSON } from "./tracks";
export { conformerCount, occupancyEntropy, altlocRmsf } from "./altloc-metrics";
export { bIsoMean } from "./bfactor";
export { conformerSupport, mapSupportDelta, mapValueTracks } from "./map";
export type { ConformerSupportRow, MapSampler } from "./map";
export { modelRmsd } from "./rmsd";
