import type { Track } from "./tracks";
import { trackDelta, trackSpread } from "./tracks";

// Metrics made from one registered metric computed on several models: the difference to a
// reference model, or the disagreement across a set of models. The caller computes the
// base metric per model (and may cache it); combineDerived does the rest.

export interface DerivedMetric {
  id: string;
  label: string;
  description: string;
  unit?: string;
  /** the registered metric computed on each model */
  of: string;
  /** delta: the model minus the reference; spread: max minus min across the compared models */
  combine: "delta" | "spread";
}

const list: DerivedMetric[] = [
  {
    id: "motion-delta",
    label: "Motion vs reference",
    description:
      "Total motion of the model minus that of the reference model, per residue. Positive: the model describes more motion there than the reference does.",
    unit: "A",
    of: "motion-total",
    combine: "delta",
  },
  {
    id: "motion-spread",
    label: "Motion disagreement",
    description:
      "Range (largest minus smallest) of total motion across the compared models, per residue: where the models disagree about how much the residue moves.",
    unit: "A",
    of: "motion-total",
    combine: "spread",
  },
];

export const DERIVED_METRICS: ReadonlyMap<string, DerivedMetric> = new Map(list.map((m) => [m.id, m]));

/** `own` is the base metric of the model the result is keyed by; `others` is the reference's
 * track (delta) or the tracks of the other compared models (spread). Null when there is
 * nothing to compare against. */
export function combineDerived(metric: DerivedMetric, own: Track, others: readonly Track[]): Track | null {
  if (!others.length) return null;
  if (metric.combine === "delta") return trackDelta(own, others[0], { metricId: metric.id });
  return trackSpread(own, others, { metricId: metric.id });
}
