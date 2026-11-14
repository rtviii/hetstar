import type { OnRequestState } from "../../hooks/useModelMetrics";
import type { RepColorMode } from "../../lib/molstar/repstyle";
import { METRIC_GROUPS, METRIC_UI, metricLabel, type MetricId } from "../compare/metrics";
import type { TipContent } from "../compare/ui";

// The colour board's model. Everything in the viewer that can be coloured is a TARGET (the
// main view's model, its map, its sequence lane, each replica box), and everything that can
// colour it is a SOURCE (a look, a metric, the RSCC of a locus). A target says what it shows
// now, which sources it can show, and how to switch; the board lays the two out against
// each other and knows nothing else about either.

/** "none" | "look:ghost" | "look:<colour mode>" | "metric:<metric id>" | "locus:<locus id>" */
export type ColorSourceId = string;

export const SOURCE_NONE: ColorSourceId = "none";
export const SOURCE_GHOST: ColorSourceId = "look:ghost";
export const lookSource = (mode: RepColorMode): ColorSourceId => `look:${mode}`;
export const metricSource = (id: MetricId): ColorSourceId => `metric:${id}`;
export const locusSource = (id: string): ColorSourceId => `locus:${id}`;

export function metricOfSource(source: ColorSourceId): MetricId | null {
  return source.startsWith("metric:") ? (source.slice(7) as MetricId) : null;
}

export function lookOfSource(source: ColorSourceId): RepColorMode | null {
  return source.startsWith("look:") && source !== SOURCE_GHOST ? (source.slice(5) as RepColorMode) : null;
}

export function locusOfSource(source: ColorSourceId): string | null {
  return source.startsWith("locus:") ? source.slice(6) : null;
}

/** how one source stands for one target; null where the target never shows that source */
export type ColorCell =
  | { state: "available" }
  /** computed only when asked for: choosing it computes it */
  | { state: "request"; status: "absent" | "computing" }
  | { state: "unavailable"; reason: string }
  | null;

export interface ColorTarget {
  /** "main:model" | "main:map" | "main:sequence" | "box:<key>" */
  id: string;
  /** the column group it stands under */
  group: string;
  /** a few letters for the column head */
  label: string;
  /** its full name */
  title: string;
  /** the identity colour of its model */
  swatch: number | null;
  current: ColorSourceId;
  cell(source: ColorSourceId): ColorCell;
  choose(source: ColorSourceId): void;
}

export const TARGET_MODEL = "main:model";
export const TARGET_MAP = "main:map";
export const TARGET_SEQUENCE = "main:sequence";
export const boxTarget = (key: number) => `box:${key}`;

export interface ColorSourceRow {
  id: ColorSourceId;
  label: string;
  /** the colour scale of a metric */
  ramp?: number[];
}

export interface ColorSourceGroup {
  id: string;
  title: string;
  rows: ColorSourceRow[];
}

const LOOK_LABELS: Record<RepColorMode, string> = {
  conformer: "Conformers",
  model: "Model",
  element: "Element",
  chain: "Chain",
};

/** the board's rows: the looks, the metrics by concept, then the scored loci */
export function colorSourceGroups(args: {
  colorModes: readonly RepColorMode[];
  loci: readonly { id: string; label: string; ramp: number[] }[];
}): ColorSourceGroup[] {
  const groups: ColorSourceGroup[] = [
    {
      id: "look",
      title: "Look",
      rows: [
        { id: SOURCE_NONE, label: "None" },
        { id: SOURCE_GHOST, label: "Ghost" },
        ...args.colorModes.map((mode) => ({ id: lookSource(mode), label: LOOK_LABELS[mode] })),
      ],
    },
    ...METRIC_GROUPS.map((group) => ({
      id: group.id,
      title: group.title,
      rows: group.ids.map((id) => ({ id: metricSource(id), label: metricLabel(id), ramp: METRIC_UI[id].colors })),
    })),
  ];
  if (args.loci.length) {
    groups.push({
      id: "loci",
      title: "Loci",
      rows: args.loci.map((locus) => ({ id: locusSource(locus.id), label: `RSCC of ${locus.label}`, ramp: locus.ramp })),
    });
  }
  return groups;
}

/** what a source is called on the buttons that open the board */
export function colorSourceLabel(source: ColorSourceId, loci: readonly { id: string; label: string }[] = []): string {
  if (source === SOURCE_NONE) return "none";
  if (source === SOURCE_GHOST) return "ghost";
  const look = lookOfSource(source);
  if (look) return LOOK_LABELS[look].toLowerCase();
  const metric = metricOfSource(source);
  if (metric) return metricLabel(metric);
  const locusId = locusOfSource(source);
  const locus = locusId ? loci.find((candidate) => candidate.id === locusId) : undefined;
  return locus ? `RSCC of ${locus.label}` : source;
}

/** a metric's cell from what the engine says about it for one model */
export function metricCell(unavailable: string | null, request: OnRequestState | null): ColorCell {
  if (request && request.status !== "blocked") {
    return request.status === "ready" ? { state: "available" } : { state: "request", status: request.status };
  }
  return unavailable ? { state: "unavailable", reason: unavailable } : { state: "available" };
}

const LOOK_TIPS: Record<RepColorMode, TipContent> = {
  conformer: {
    title: "Conformers",
    is: "Pale chains; purple deepens with the number of conformers a residue has.",
    rows: [
      { label: "ligands", text: "One quiet hue per compound; ions grey." },
      { label: "ramp", text: "Chosen at the end of this row; \"fade\" also ghosts single-conformer residues on the cartoon." },
    ],
  },
  model: { title: "Model", is: "One identity colour per model, the same in the main view, the boxes and this board." },
  element: { title: "Element", is: "Heteroatoms in CPK colours; carbons keep the model's identity colour." },
  chain: { title: "Chain", is: "One colour per chain." },
};

/** the explanation of a source that is not a metric */
export function lookTip(source: ColorSourceId): TipContent | null {
  if (source === SOURCE_NONE) return { title: "None", is: "The target's own colour: the map in its blue, the sequence unpainted." };
  if (source === SOURCE_GHOST) {
    return {
      title: "Ghost",
      is: "The replica translucent in its model's identity colour, so mirrored selections and overrides read through it.",
    };
  }
  const look = lookOfSource(source);
  if (look) return LOOK_TIPS[look];
  if (locusOfSource(source)) {
    return {
      title: "RSCC of a locus",
      is: "The locus residue by residue, painted on the 2Fo-Fc surface inside its shared mask; the rest of the map keeps its colour.",
      rows: [
        { label: "model", text: "The main view's model." },
        { label: "computed", text: "On choosing, if the locus has no score yet; kept until erased in the loci stack." },
      ],
    };
  }
  return null;
}
