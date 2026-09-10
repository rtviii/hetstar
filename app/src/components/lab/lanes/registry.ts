import { conformerLane, metricLane } from "./PlotLanes";
import { sequenceLane } from "./SequenceLane";
import { secondaryLane, unobservedLane } from "./SpanLanes";
import type { LaneModule } from "./types";

// Every lane the drawer offers, in display order. Adding a lane = one module here.
// Future lanes (domains from an annotation service, ligand contacts, per-residue
// validation) plug in the same way; async data belongs in the module's Component or in
// the context the host is given, never in the host.
export const LANE_MODULES: readonly LaneModule[] = [sequenceLane, conformerLane, metricLane, secondaryLane, unobservedLane];

export function defaultEnabledLanes(): Set<string> {
  return new Set(LANE_MODULES.filter((m) => m.defaultOn).map((m) => m.id));
}
