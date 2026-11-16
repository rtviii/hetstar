"use client";
import { type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction, useEffect, useMemo, useState } from "react";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { frameOffset } from "@dynamic-pdb/hetkit/metrics";
import type { AtomTable, ResidueRef } from "@dynamic-pdb/hetkit/model";
import type { BundleState, ModelBundles } from "../../hooks/useModelBundles";
import type { ModelMetrics } from "../../hooks/useModelMetrics";
import { modelDetailRows, modelDisplayName, modelFileLine } from "../../lib/dpdb/names";
import { ROLE_LABELS, type EntryManifest, type ManifestModel } from "../../lib/dpdb/types";
import type { Emitter } from "../../lib/lab/emitter";
import { altlocSummaryOf } from "../../lib/lab/model-bundle";
import type { LabSelection } from "../../lib/lab/selection";
import type { ModelLook } from "../../lib/molstar/appearance";
import { createPoseGroup } from "../../lib/molstar/camera-sync";
import type { ReplicaGlass } from "../../lib/molstar/replica";
import type { SelRepOverlay } from "../../lib/molstar/selrep";
import { GHOST_B_COLOR } from "../../lib/molstar/style";
import type { TrackPaint } from "../../lib/molstar/track-theme";
import type { MolstarViewer as ViewerInstance, PickInfo } from "../../lib/molstar/viewer";
import type { HetstarPreset } from "../../presets/types";
import { lookOfSource, metricOfSource } from "../board/board";
import { metricLabel } from "../compare/metrics";
import { isLoadable, maxReplicas, OFF_FRAME_ANGSTROM, withCard, type ModelCards, type SwitchboardOptions } from "./cards";
import ModelCard, { type HoverTarget, type ModelFact, type ReplicaWiring } from "./SwitchboardBox";

// The Models Switchboard: the layer where the models of an entry are told apart and placed.
// A panel at the viewer's right edge, the models stacked in it; drag its left edge to size
// it. Every model has a card: on its left what the model is, with the switches that make it
// the main view, draw it behind the main view, open its style, mark it as the reference, and
// show its replica; on its right that replica. A replica is the WHOLE model in a small canvas
// turned exactly like the main view; it carries the main view's selection, overrides and
// hover, and marks the region the main view is on, so it reads as a minimap of that model
// and as a side-by-side of the entry's models.

const VIEW_SPHERE_DEBOUNCE_MS = 150;
const MIN_WIDTH = 300;
const MAX_WIDTH = 720;
/** the panel's width, kept while the page lives: a card is its facts beside its replica */
let rememberedWidth = 400;

interface ModelsSwitchboardProps {
  /** the panel is unfolded; folded, the host shows a chip that opens it */
  open: boolean;
  onOpen: (open: boolean) => void;
  mainViewer: ViewerInstance | null;
  /** the main view finished loading its model */
  primaryLoaded: boolean;
  entry: EntryManifest | null;
  /** the model the main view holds */
  mainId: string | null;
  /** its atoms on screen; the other models are measured against them */
  mainTable: AtomTable | null;
  /** ask for a model to become the main view */
  onMain: (modelId: string) => void;
  /** asked for, waiting for its file or for the maps */
  pendingMainId: string | null;
  /** the model every pair metric compares against */
  referenceId: string | null;
  /** the user marks a model as the reference (null: back to the default) */
  onReference: (modelId: string | null) => void;
  /** one card per model, held by the host so that the style board can restyle them */
  cards: ModelCards;
  onCards: Dispatch<SetStateAction<ModelCards>>;
  /** the models whose replica is on right now, in entry order */
  onBoxedModels: (modelIds: readonly string[]) => void;
  /** the identity colour of each model */
  colors: ReadonlyMap<string, number>;
  /** the metric paint of each model that shows one */
  paints: ReadonlyMap<string, TrackPaint>;
  /** open the style board on one model */
  onStyle: (modelId: string) => void;
  /** the model whose own style board is open */
  styleModelId: string | null;
  /** the members of the main view's model when it is an ensemble: their numbers as filed */
  memberNumbers: readonly number[];
  memberIndex: number;
  onMember: (index: number) => void;
  bundles: ModelBundles;
  /** metrics of any model of the entry */
  metrics: ModelMetrics;
  /** a replica shows this model: its stored residue data is wanted */
  onNeedStoredData: (modelId: string) => void;
  preset: HetstarPreset;
  selection: LabSelection;
  selRepOverlays: readonly SelRepOverlay[];
  hoverBus: Emitter<HoverTarget>;
  clip: { center: [number, number, number]; radius: number } | null;
  onNavigate: (pick: PickInfo) => void;
  onHoverResidue: (ref: ResidueRef | null) => void;
  options?: SwitchboardOptions;
}

const offsetCache = new WeakMap<AtomTable, WeakMap<AtomTable, { mean: number; matched: number }>>();

/** how far a model sits from the main view's model as filed, computed once per pair of tables */
function offsetBetween(main: AtomTable, other: AtomTable): { mean: number; matched: number } {
  let byOther = offsetCache.get(main);
  if (!byOther) {
    byOther = new WeakMap();
    offsetCache.set(main, byOther);
  }
  let offset = byOther.get(other);
  if (!offset) {
    offset = frameOffset(main, other);
    byOther.set(other, offset);
  }
  return offset;
}

/** what a card says about its model: the catalogue's facts, then what its file shows */
function modelFacts(
  model: ManifestModel,
  state: BundleState | undefined,
  mainTable: AtomTable | null,
  isMain: boolean,
): ModelFact[] {
  const facts: ModelFact[] = [];
  const kind = [model.modelType, model.purpose].filter(Boolean).join(", ");
  facts.push({ label: "kind", text: kind ? `${ROLE_LABELS[model.role]} (${kind})` : ROLE_LABELS[model.role] });
  if (model.software) facts.push({ label: "made by", text: model.software });
  const { r_work: rWork, r_free: rFree } = model.metrics;
  if (rWork != null || rFree != null) {
    facts.push({ label: "R w / f", text: `${rWork != null ? rWork.toFixed(3) : "n/a"} / ${rFree != null ? rFree.toFixed(3) : "n/a"}` });
  }
  const bundle = state?.status === "ready" ? state.bundle : null;
  if (bundle?.ensemble && bundle.ensemble.modelCount > 1) {
    facts.push({ label: "members", text: String(bundle.ensemble.modelCount) });
  } else if (bundle) {
    const altlocs = altlocSummaryOf(bundle);
    facts.push({
      label: "altlocs",
      text: altlocs?.residues.length
        ? `${altlocs.residues.length} of ${altlocs.totalResidueCount} residues, ${(altlocs.atomFractionWithAltloc * 100).toFixed(0)}% of atoms`
        : "none",
    });
  } else if (model.memberCount && model.memberCount > 1) {
    facts.push({ label: "members", text: String(model.memberCount) });
  }
  if (bundle && mainTable && !isMain) {
    const offset = offsetBetween(mainTable, bundle.table);
    if (offset.matched > 0) {
      const off = offset.mean > OFF_FRAME_ANGSTROM;
      facts.push({
        label: "frame",
        text: `${offset.mean.toFixed(2)} A from main${off ? ": off-frame, overlays and comparisons with it do not hold" : ""}`,
        warn: off,
      });
    } else {
      facts.push({ label: "frame", text: "no residue shared with the main model", warn: true });
    }
  }
  const status = state?.status === "loading" ? ", loading" : state?.status === "error" ? ", failed to load" : !state && isLoadable(model) ? ", not loaded" : "";
  facts.push({ label: "file", text: `${modelFileLine(model)}${status}` });
  return facts;
}

export default function ModelsSwitchboard({
  open,
  onOpen,
  mainViewer,
  primaryLoaded,
  entry,
  mainId,
  mainTable,
  onMain,
  pendingMainId,
  referenceId,
  onReference,
  cards,
  onCards: setCards,
  onBoxedModels,
  colors,
  paints,
  onStyle,
  styleModelId,
  memberNumbers,
  memberIndex,
  onMember,
  bundles,
  metrics,
  onNeedStoredData,
  preset,
  selection,
  selRepOverlays,
  hoverBus,
  clip,
  onNavigate,
  onHoverResidue,
  options,
}: ModelsSwitchboardProps) {
  const replicaCap = maxReplicas(options);
  const [width, setWidth] = useState(rememberedWidth);
  const poseGroup = useMemo(() => createPoseGroup(), []);

  const models = useMemo(() => entry?.models ?? [], [entry]);
  const active = open && primaryLoaded;

  // the models whose replica is on are the ones the board lists as replicas
  const replicaIds = useMemo(
    () => models.filter((model) => isLoadable(model) && cards[model.id]?.replica).map((model) => model.id),
    [models, cards],
  );
  useEffect(() => {
    onBoxedModels(active ? replicaIds : []);
  }, [active, replicaIds, onBoxedModels]);

  // a replica needs its model's file
  const requestBundle = bundles.request;
  useEffect(() => {
    if (!active) return;
    for (const model of models) {
      if (!isLoadable(model) || !cards[model.id]?.replica) continue;
      onNeedStoredData(model.id);
      requestBundle(model);
    }
  }, [active, models, cards, requestBundle, onNeedStoredData]);

  // the main camera is the pose reference
  const mainCamera = primaryLoaded ? (mainViewer?.ctx?.canvas3d?.camera ?? null) : null;
  useEffect(() => {
    if (!mainCamera) return;
    const member = poseGroup.join(mainCamera);
    return () => member.leave();
  }, [mainCamera, poseGroup]);

  // --- looking glass: the clip sphere, else what the main camera frames ---

  const [viewSphere, setViewSphere] = useState<{ center: [number, number, number]; radius: number } | null>(null);
  useEffect(() => {
    if (!mainCamera || !active) {
      setViewSphere(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      timer = null;
      const { width, height } = mainCamera.viewport;
      const aspect = height > 0 ? width / height : 1;
      const distance = Vec3.distance(mainCamera.position, mainCamera.target);
      const radius = distance * Math.tan(mainCamera.state.fov / 2) * Math.min(1, aspect);
      const [x, y, z] = mainCamera.target;
      setViewSphere((prev) =>
        prev &&
        Math.abs(prev.radius - radius) < 0.05 &&
        Math.hypot(prev.center[0] - x, prev.center[1] - y, prev.center[2] - z) < 0.05
          ? prev
          : { center: [x, y, z], radius },
      );
    };
    measure();
    const subscription = mainCamera.changed.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(measure, VIEW_SPHERE_DEBOUNCE_MS);
    });
    return () => {
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [mainCamera, active]);

  const glass = useMemo<ReplicaGlass | null>(() => {
    if (clip) return { center: clip.center, radius: clip.radius, always: true };
    return viewSphere ? { ...viewSphere, always: false } : null;
  }, [clip, viewSphere]);

  const wiring = useMemo<ReplicaWiring>(
    () => ({
      colorThemes: preset.colorThemes,
      poseGroup,
      selection,
      selRepOverlays,
      hoverBus,
      glass,
      onHoverResidue,
      onNavigate,
    }),
    [preset.colorThemes, poseGroup, selection, selRepOverlays, hoverBus, glass, onHoverResidue, onNavigate],
  );

  if (!entry || !mainId || !open) return null;

  const nameOf = (id: string | null) => {
    const model = id ? models.find((candidate) => candidate.id === id) : undefined;
    return model ? modelDisplayName(model, models) : null;
  };
  const replicaAllowed = replicaIds.length < replicaCap;

  // the left edge is dragged: the panel grows towards the canvas
  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (move: PointerEvent) => {
      rememberedWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + startX - move.clientX));
      setWidth(rememberedWidth);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <aside data-hetstar-part="switchboard" className="hs-panel relative flex shrink-0 flex-col border-l border-line bg-white" style={{ width }}>
      <div
        className="absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-ew-resize hover:bg-accent/30"
        title="drag to change the panel's width"
        onPointerDown={startResize}
      />
      <div className="hs-head">
        <span className="hs-head-title">Models Switchboard</span>
        <button
          type="button"
          className="hs-btn hs-btn-sm hs-btn-icon hs-btn-quiet ml-auto"
          title="fold the Models Switchboard away"
          aria-label="fold the Models Switchboard away"
          onClick={() => onOpen(false)}
        >
          {"\u00bb"}
        </button>
      </div>
      <div className="flex h-[22px] shrink-0 items-center gap-3 border-b border-line px-2.5 text-[10.5px] text-ink-secondary">
        <span title="the model the others are compared against; mark another one with the ref button of its card" className="flex min-w-0 items-baseline gap-1">
          <span className="hs-label">ref</span>
          <span className="truncate text-ink">{nameOf(referenceId) ?? "none"}</span>
        </span>
        <span className="hs-label ml-auto shrink-0" title="replicas on, of the most that can be on at once">
          {replicaIds.length}/{replicaCap} replicas
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-surface-muted p-2">
        {!primaryLoaded && <span className="hs-label px-0.5">waiting for the main view</span>}
        {models.map((model) => {
          const card = cards[model.id];
          if (!card) return null;
          const state = bundles.states.get(model.id);
          const isMain = model.id === mainId;
          const paint = paints.get(model.id);
          const mode = lookOfSource(card.look.color);
          const look: ModelLook = {
            rep: card.look.rep,
            het: card.look.het,
            ions: card.look.ions,
            paint: paint ? { kind: "track", paint } : mode ? { kind: "color", mode } : { kind: "ghost" },
          };
          const name = modelDisplayName(model, models);
          const metric = metricOfSource(card.look.color);
          const computing = metric && metrics.requested(model.id, metric)?.status === "computing" ? `${metricLabel(metric)} of ${name}` : null;
          const bundle = state?.status === "ready" ? state.bundle : null;
          const memberCount = isMain ? memberNumbers.length : (bundle?.ensemble?.modelCount ?? 0);
          return (
            <ModelCard
              key={model.id}
              name={name}
              detail={modelDetailRows(model)}
              facts={modelFacts(model, state, mainTable, isMain)}
              color={colors.get(model.id) ?? GHOST_B_COLOR}
              loadable={isLoadable(model)}
              bundle={state}
              isMain={isMain}
              mainPending={pendingMainId === model.id}
              onMain={() => onMain(model.id)}
              sceneVisible={card.sceneVisible}
              onSceneVisible={() => setCards((previous) => withCard(previous, model.id, (c) => ({ ...c, sceneVisible: !c.sceneVisible })))}
              isReference={model.id === referenceId}
              onReference={() => onReference(model.id === referenceId ? null : model.id)}
              replica={active && card.replica}
              replicaAllowed={replicaAllowed}
              onReplica={() => setCards((previous) => withCard(previous, model.id, (c) => ({ ...c, replica: !c.replica })))}
              look={look}
              computing={computing}
              wiring={wiring}
              onStyle={() => onStyle(model.id)}
              styleOpen={styleModelId === model.id}
              members={
                memberCount > 1
                  ? {
                      count: memberCount,
                      index: isMain ? memberIndex : 0,
                      number: isMain ? (memberNumbers[memberIndex] ?? memberIndex + 1) : 1,
                      onMember,
                    }
                  : null
              }
            />
          );
        })}
      </div>
    </aside>
  );
}
