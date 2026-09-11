import { ANNOTATION_LANES } from "./AnnotationLanes";
import { ligandContactLane } from "./ContactLane";
import { conformerLane } from "./PlotLanes";
import { sequenceLane } from "./SequenceLane";
import { secondaryLane, unobservedLane } from "./SpanLanes";
import type { LaneModule } from "./types";

// Every structural lane the drawer offers, in display order. Adding a lane = one module
// here. Metric lanes are NOT listed: the host generates one per metric with
// makeMetricLane and passes them in, so the metric list stays app-level knowledge.
// Async data (the PDBe annotations) is host-fetched once per entry and flows in through
// LaneContext.annotations — a lane module never fetches for itself, so the drawer can
// state why a lane cannot draw ("fetching...", "PDBe lists none").
export const LANE_MODULES: readonly LaneModule[] = [
  sequenceLane,
  conformerLane,
  secondaryLane,
  unobservedLane,
  ligandContactLane,
  ...ANNOTATION_LANES,
];

export function defaultEnabledLanes(): Set<string> {
  return new Set(LANE_MODULES.filter((m) => m.defaultOn).map((m) => m.id));
}
