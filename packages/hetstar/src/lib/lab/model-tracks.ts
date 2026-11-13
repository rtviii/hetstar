import {
  altlocRmsf,
  bIsoMean,
  conformerCount,
  ensembleRmsf,
  modelRmsd,
  occupancyEntropy,
  trackDelta,
  type Track,
} from "@dynamic-pdb/hetkit/metrics";
import type { AtomTable } from "@dynamic-pdb/hetkit/model";
import type { MetricId } from "../../components/compare/metrics";

// The metrics that need nothing but atom tables: computable for any model of the entry,
// not only the one the main view holds. The map-sampled and bond metrics stay with the
// main view, which owns the density volumes and the interaction pass.

export const TABLE_METRICS: readonly MetricId[] = [
  "conformer-count",
  "occupancy-entropy",
  "b-iso-mean",
  "ensemble-rmsf",
  "model-rmsd",
  "altloc-rmsf-delta",
];

export interface TableTrackInput {
  table: AtomTable;
  /** the model the pair metrics compare against; null leaves them unavailable */
  reference: AtomTable | null;
  /** one table per ensemble member; fewer than two leaves the ensemble metric unavailable */
  members: readonly AtomTable[];
}

export function computeTableTrack(id: MetricId, input: TableTrackInput): Track | null {
  const { table, reference, members } = input;
  switch (id) {
    case "conformer-count":
      return conformerCount(table);
    case "occupancy-entropy":
      return occupancyEntropy(table);
    case "b-iso-mean":
      return bIsoMean(table);
    case "ensemble-rmsf":
      return members.length >= 2 ? ensembleRmsf([...members]) : null;
    case "model-rmsd":
      return reference ? modelRmsd(table, reference) : null;
    case "altloc-rmsf-delta":
      return reference ? trackDelta(altlocRmsf(table), altlocRmsf(reference), { metricId: "altloc-rmsf-delta" }) : null;
    default:
      return null;
  }
}
