import type { OnRequestState } from "../../hooks/useModelMetrics";
import { REP_KINDS, type RepColorMode, type RepKind } from "../../lib/molstar/repstyle";
import { METRIC_GROUPS, METRIC_UI, metricLabel, type MetricId } from "../compare/metrics";
import type { TipContent } from "../compare/ui";

// The style board's model. Everything in the viewer that has a look is a TARGET (each model
// of the entry, the map, the sequence lane), and everything a look is made of is a ROW: what
// a model is drawn as, which of its parts show, and what colours it (a look, a metric, the
// RSCC of a locus). A target says which rows it shows now, which it can show, and how to
// switch; the board lays the two out against each other and knows nothing else about either.
// The same board is opened whole (every model and the map), for one model from its card, or
// for the sequence lane from the lanes strip: the rows are the same catalogue each time.

/** "none" | "look:ghost" | "look:<colour mode>" | "metric:<metric id>" | "locus:<locus id>" */
export type ColorSourceId = string;
/** a colour source, "rep:<kind>" or "part:het" | "part:ion" */
export type BoardRowId = string;

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

export const repRow = (kind: RepKind): BoardRowId => `rep:${kind}`;
export const PART_HET: BoardRowId = "part:het";
export const PART_IONS: BoardRowId = "part:ion";

export function repOfRow(row: BoardRowId): RepKind | null {
  return row.startsWith("rep:") ? (row.slice(4) as RepKind) : null;
}

export function isShapeRow(row: BoardRowId): boolean {
  return row.startsWith("rep:") || row.startsWith("part:");
}

/** how a model looks: what colours it, what its polymer is drawn as, which parts show */
export interface Appearance {
  color: ColorSourceId;
  rep: RepKind;
  het: boolean;
  ions: boolean;
}

export function appearanceShows(appearance: Appearance, row: BoardRowId): boolean {
  const kind = repOfRow(row);
  if (kind) return appearance.rep === kind;
  if (row === PART_HET) return appearance.het;
  if (row === PART_IONS) return appearance.ions;
  return appearance.color === row;
}

/** the appearance after its row was clicked: a representation or a colour replaces the one
 * before it, a part flips */
export function appearanceWith(appearance: Appearance, row: BoardRowId): Appearance {
  const kind = repOfRow(row);
  if (kind) return { ...appearance, rep: kind };
  if (row === PART_HET) return { ...appearance, het: !appearance.het };
  if (row === PART_IONS) return { ...appearance, ions: !appearance.ions };
  return { ...appearance, color: row };
}

/** how one row stands for one target; null where the target never shows that row */
export type BoardCell =
  | { state: "available" }
  /** computed only when asked for: choosing it computes it */
  | { state: "request"; status: "absent" | "computing" }
  | { state: "unavailable"; reason: string }
  | null;

export interface BoardTarget {
  /** "model:<model id>" | "main:map" | "main:sequence" */
  id: string;
  /** the column group it stands under */
  group: string;
  /** its name at the head of the column */
  label: string;
  /** its full name, for the cells' own hints */
  title: string;
  /** what it is, on the column head */
  tip: TipContent;
  /** the identity colour of its model */
  swatch: number | null;
  /** the model the main view holds */
  main?: boolean;
  /** shown or hidden; null where there is nothing to switch */
  visible: boolean | null;
  onVisible?(visible: boolean): void;
  shows(row: BoardRowId): boolean;
  cell(row: BoardRowId): BoardCell;
  choose(row: BoardRowId): void;
}

export const modelTarget = (modelId: string) => `model:${modelId}`;
export const TARGET_MAP = "main:map";
export const TARGET_SEQUENCE = "main:sequence";

/** what a board is opened on: everything, one model, or the sequence lane */
export type BoardScope = { kind: "all" } | { kind: "model"; modelId: string } | { kind: "sequence" };
export const SCOPE_ALL: BoardScope = { kind: "all" };

export interface BoardTab {
  id: string;
  title: string;
  groups: BoardGroup[];
}

export interface BoardRow {
  id: BoardRowId;
  label: string;
  /** the colour scale of a metric */
  ramp?: number[];
  /** on or off by itself; other rows of a group replace one another */
  toggle?: boolean;
}

export interface BoardGroup {
  id: string;
  title: string;
  rows: BoardRow[];
}

const REP_LABELS: Record<RepKind, string> = {
  cartoon: "Cartoon",
  "cartoon-sticks": "Cartoon + side chains",
  "ball-and-stick": "Sticks",
  spacefill: "Atoms",
};

/** the shape rows: what the polymer is drawn as, then the parts drawn beside it */
export function shapeGroups(): BoardGroup[] {
  return [
    {
      id: "rep",
      title: "Representation",
      rows: REP_KINDS.map((kind) => ({ id: repRow(kind), label: REP_LABELS[kind] })),
    },
    {
      id: "parts",
      title: "Parts",
      rows: [
        { id: PART_HET, label: "Ligands", toggle: true },
        { id: PART_IONS, label: "Ions", toggle: true },
      ],
    },
  ];
}

const SHAPE_TIPS: Record<string, TipContent> = {
  [repRow("cartoon")]: {
    title: "Cartoon",
    is: "The polymer as a trace through its backbone.",
    rows: [
      { label: "hides", text: "Side chains, and with them the alternate conformers of a residue." },
      { label: "ligands", text: "Stay as sticks; ions as small spheres." },
    ],
  },
  [repRow("cartoon-sticks")]: {
    title: "Cartoon + side chains",
    is: "The trace, with every side chain drawn as thin sticks from its CA.",
    rows: [
      { label: "conformers", text: "Collapsed to the highest occupancy; expanding a residue shows its letters on the sticks." },
      { label: "left out", text: "Backbone N, C and O, and glycine." },
    ],
  },
  [repRow("ball-and-stick")]: {
    title: "Sticks",
    is: "Every heavy atom of the polymer as ball and stick.",
    rows: [{ label: "hydrogens", text: "Never drawn." }],
  },
  [repRow("spacefill")]: {
    title: "Atoms",
    is: "Every heavy atom of the polymer as a sphere.",
    rows: [{ label: "size", text: "A fraction of the van der Waals radius, set at the end of this row." }],
  },
  [PART_HET]: { title: "Ligands", is: "Every compound that is neither polymer, ion nor water, as sticks." },
  [PART_IONS]: { title: "Ions", is: "Single-atom compounds, as small spheres." },
};

/** the explanation of a shape row */
export function shapeTip(row: BoardRowId): TipContent | null {
  return SHAPE_TIPS[row] ?? null;
}

const LOOK_LABELS: Record<RepColorMode, string> = {
  conformer: "Conformers",
  model: "Model",
  element: "Element",
  chain: "Chain",
};

/** the colour rows: the looks, the metrics by concept, then the scored loci */
export function colorSourceGroups(args: {
  colorModes: readonly RepColorMode[];
  loci: readonly { id: string; label: string; ramp: number[] }[];
}): BoardGroup[] {
  const groups: BoardGroup[] = [
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
export function metricCell(unavailable: string | null, request: OnRequestState | null): BoardCell {
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
      { label: "cartoon", text: "Residues with one conformer are drawn translucent, so the others stand out." },
    ],
  },
  model: { title: "Model", is: "One identity colour per model, the same in the main view, its replica and this board." },
  element: { title: "Element", is: "Heteroatoms in CPK colours; carbons keep the model's identity colour." },
  chain: { title: "Chain", is: "One colour per chain." },
};

/** the explanation of a source that is not a metric */
export function lookTip(source: ColorSourceId): TipContent | null {
  if (source === SOURCE_NONE) return { title: "None", is: "The target's own colour: the map in its blue, the sequence unpainted." };
  if (source === SOURCE_GHOST) {
    return {
      title: "Ghost",
      is: "The model translucent in its identity colour: a silhouette behind the main view's model, and a replica that mirrored selections read through.",
      rows: [{ label: "main view", text: "Not offered on the main view's own model, which is the one picked and measured." }],
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
