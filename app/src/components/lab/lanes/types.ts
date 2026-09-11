import type { ComponentType } from "react";

import type { Track } from "@dynamic-pdb/hetkit/metrics";
import type { AtomTable, ChainSequence, SecondarySpan } from "@dynamic-pdb/hetkit/model";
import type { AnnotationsBySource } from "@/lib/annotations/pdbe";
import type { ConformerPlan } from "@/lib/molstar/conformers";

// The lane framework. One chain's polymer sequence is the x-axis: positions 1..length,
// bridged to author-keyed residues by hetkit's SequenceModel (the same ResidueRefs Mol*
// picks, metrics and qFit letters use). Each LaneModule draws ONE row against that axis.
// The host (SequenceLanes.tsx) owns the chain picker, ruler, zoom, scrolling,
// hit-testing, hover and selection; lanes only draw, and may offer clickable spans.
// Lanes never receive hover or selection state: the host paints both as columns over
// the whole board, so a lane re-renders only when its data or the geometry changes.

export interface PositionSpan {
  /** 1-based, inclusive */
  start: number;
  end: number;
}

export interface LaneMetric {
  id: string;
  name: string;
  unit: string | null;
  colors: number[];
  /** the display domain of the 3D paint (sequential ramps start at 0, unlike track.domain) */
  domain: [number, number];
  track: Track;
}

export interface LaneContext {
  chain: ChainSequence;
  aTable: AtomTable | null;
  confPlan: ConformerPlan;
  /** helix and strand spans of this chain in positions; null when the source file has none */
  secondary: SecondarySpan[] | null;
  /** computed tracks by metric id; a string is why that metric cannot be computed yet */
  metrics: Map<string, LaneMetric | string>;
  /** ramp coloring of the sequence lane, resolved by the host from its color-by choice */
  colorBy: LaneMetric | null;
  /** PDBe annotations, host-fetched once per entry; "loading" while in flight, null without a PDB id */
  annotations: AnnotationsBySource | "loading" | null;
}

export interface LaneView {
  length: number;
  /** the lane's width in CSS px; 0 before layout */
  width: number;
  /** px per position (width / length) */
  cell: number;
}

export interface LaneProps {
  ctx: LaneContext;
  view: LaneView;
  /** lanes with clickable features call this to select a span (the host maps it to residues) */
  onSelectSpan: (span: PositionSpan) => void;
}

export interface LaneModule {
  /** stable id; also the persistence key of the on/off state */
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
  /** px height of the lane's track area; a function for lanes whose height depends on the data (packed sub-rows) */
  height: number | ((ctx: LaneContext) => number);
  /** null when the lane can draw for this context; otherwise why not (the drawer shows it disabled) */
  unavailable: (ctx: LaneContext) => string | null;
  Component: ComponentType<LaneProps>;
  /** one short phrase about the hovered position, appended to the host's readout line */
  readout?: (ctx: LaneContext, pos: number) => string | null;
}

/** CSS placement of a span as a share of the lane: holds fitted and zoomed alike. */
export function spanStyle(span: PositionSpan, length: number): { left: string; width: string } {
  const n = Math.max(1, length);
  return {
    left: `${((span.start - 1) / n) * 100}%`,
    width: `${((span.end - span.start + 1) / n) * 100}%`,
  };
}
