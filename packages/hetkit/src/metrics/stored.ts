import type { ResidueRef } from "../model/keys";
import { residueKey } from "../model/keys";
import type { Track } from "./tracks";
import { makeTrack } from "./tracks";

// Per-residue values the catalogue stores for a model (its `residue_data`), as Tracks.
// They are a second producer next to the computed metrics and keep their own ids: the
// stored B is the validation report's number, not hetkit's b-iso-mean.

export interface StoredResidueRow {
  ref: ResidueRef;
  rscc: number | null;
  bIso: number | null;
  occupancy: number | null;
}

export const STORED_METRIC_IDS = ["stored-rscc", "stored-b-iso", "stored-occupancy"] as const;
export type StoredMetricId = (typeof STORED_METRIC_IDS)[number];

export interface StoredMetricInfo {
  id: StoredMetricId;
  label: string;
  description: string;
  unit?: string;
}

export const STORED_METRICS: ReadonlyMap<string, StoredMetricInfo> = new Map(
  (
    [
      {
        id: "stored-rscc",
        label: "RSCC (stored)",
        description:
          "Real-space correlation coefficient of the residue against the map, from the wwPDB validation report as served by RCSB (feature RSCC). Stored in the catalogue, not computed here.",
      },
      {
        id: "stored-b-iso",
        label: "Mean B (stored)",
        description:
          "Occupancy-weighted average B of the residue from the wwPDB validation report as served by RCSB (feature OWAB). Stored in the catalogue, not computed here.",
        unit: "A^2",
      },
      {
        id: "stored-occupancy",
        label: "Occupancy (stored)",
        description:
          "Average occupancy of the residue as served by RCSB (feature AVERAGE_OCCUPANCY). Stored in the catalogue, not computed here.",
      },
    ] satisfies StoredMetricInfo[]
  ).map((info) => [info.id, info]),
);

const FIELD_OF: Record<StoredMetricId, "rscc" | "bIso" | "occupancy"> = {
  "stored-rscc": "rscc",
  "stored-b-iso": "bIso",
  "stored-occupancy": "occupancy",
};

/** One track per stored field that at least one row carries. Keys follow the row order;
 * a residue listed twice keeps its first row. */
export function storedResidueTracks(rows: readonly StoredResidueRow[]): Partial<Record<StoredMetricId, Track>> {
  const seen = new Set<string>();
  const unique: StoredResidueRow[] = [];
  for (const row of rows) {
    const key = residueKey(row.ref);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  const keys = unique.map((row) => row.ref);
  const out: Partial<Record<StoredMetricId, Track>> = {};
  for (const id of STORED_METRIC_IDS) {
    const field = FIELD_OF[id];
    const values = new Float32Array(unique.length);
    let any = false;
    unique.forEach((row, i) => {
      const value = row[field];
      if (value == null || Number.isNaN(value)) values[i] = NaN;
      else {
        values[i] = value;
        any = true;
      }
    });
    if (any) out[id] = makeTrack(id, "residue", keys, values, { unit: STORED_METRICS.get(id)?.unit });
  }
  return out;
}
