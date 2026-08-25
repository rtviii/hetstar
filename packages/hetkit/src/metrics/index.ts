import type { Volume } from "molstar/lib/mol-model/volume";
import type { AtomTable } from "../model/atoms";
import { altlocRmsf, conformerCount, occupancyEntropy } from "./altloc-metrics";
import { bIsoMean } from "./bfactor";
import { modelRmsd } from "./rmsd";
import type { Level, Track } from "./tracks";

// What a metric needs. 'model-map' is declared now so the interface already expresses
// experimental-fit metrics (RSCC, RSR); their compute lands in a later chunk.
export type MetricInput =
  | { kind: "model"; model: AtomTable }
  | { kind: "model-pair"; a: AtomTable; b: AtomTable }
  | { kind: "model-map"; model: AtomTable; map: Volume }
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
];

export const METRICS: ReadonlyMap<string, AnyMetric> = new Map(list.map((m) => [m.id, m]));

export { makeTrack, trackFromJSON, trackToJSON } from "./tracks";
export type { Level, Track, TrackJSON } from "./tracks";
export { conformerCount, occupancyEntropy, altlocRmsf } from "./altloc-metrics";
export { bIsoMean } from "./bfactor";
export { modelRmsd } from "./rmsd";
