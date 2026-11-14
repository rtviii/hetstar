"use client";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import type { Track } from "@dynamic-pdb/hetkit/metrics";
import type { ResidueRef } from "@dynamic-pdb/hetkit/model";
import type { ModelBundles } from "../../hooks/useModelBundles";
import type { ModelMetrics } from "../../hooks/useModelMetrics";
import { modelDetailRows, modelDisplayName, modelFileLine } from "../../lib/dpdb/names";
import type { EntryManifest, LoadableModel, ManifestModel } from "../../lib/dpdb/types";
import type { Emitter } from "../../lib/lab/emitter";
import type { LabSelection } from "../../lib/lab/selection";
import { createPoseGroup } from "../../lib/molstar/camera-sync";
import type { ConformerRamp } from "../../lib/molstar/ghost-theme";
import type { ReplicaFacet, ReplicaGlass } from "../../lib/molstar/replica";
import type { SelRepOverlay } from "../../lib/molstar/selrep";
import { GHOST_B_COLOR, MODEL_A_COLOR } from "../../lib/molstar/style";
import { trackPaint, type TrackPaint } from "../../lib/molstar/track-theme";
import type { MolstarViewer as ViewerInstance, PickInfo } from "../../lib/molstar/viewer";
import type { HetstarPreset } from "../../presets/types";
import { boxTarget, colorSourceLabel, lookOfSource, metricOfSource, SOURCE_GHOST, type ColorSourceId } from "../color/board";
import { displayDomain, METRIC_UI, metricLabel, metricUnit, type MetricId } from "../compare/metrics";
import { CARD_SHELL, PinPopover } from "../compare/ui";
import SwitchboardBox, { type FacetLegend, type HoverTarget } from "./SwitchboardBox";

// The Models Switchboard: a dock of small replicas, one box per model of the entry the
// user chose to look at. Every box shows its WHOLE model turned exactly like the main
// view, carries the main view's selection, overrides and hover, and marks the region the
// main view is on, so it reads as a minimap of the model in the main view and as a
// side-by-side of the entry's other models.

export interface SwitchboardOptions {
  /** whether the dock starts open; default true */
  defaultOpen?: boolean;
  /** the boxes a fresh entry opens with: its primary model alone (default), or every model up to maxBoxes */
  boxes?: "primary" | "all";
  /** most boxes at once; each one is a WebGL context of its own */
  maxBoxes?: number;
}

const DEFAULT_MAX_BOXES = 4;
/** browsers cap live WebGL contexts (16 in Chrome, fewer elsewhere); the main view has one */
const HARD_MAX_BOXES = 6;
/** identity colours of the models beside the primary and the deposited one */
const EXTRA_MODEL_COLORS = [0x9fb7a5, 0xc4a5b8, 0xa9b3cf, 0xd0b99a];
const VIEW_SPHERE_DEBOUNCE_MS = 150;

/** one box of the dock: a model and what its replica is painted with */
export interface SwitchboardBoxState {
  key: number;
  modelId: string;
  /** a colour source (components/color/board.ts): the ghost, a look or a metric */
  facetId: ColorSourceId;
}

/** the colour each model of the entry is known by, in the boxes and on the colour board */
export function modelIdentityColors(models: readonly ManifestModel[], primaryId: string | null): Map<string, number> {
  const out = new Map<string, number>();
  let extra = 0;
  for (const m of models) {
    if (m.id === primaryId) out.set(m.id, MODEL_A_COLOR);
    else if (m.role === "deposited") out.set(m.id, GHOST_B_COLOR);
    else out.set(m.id, EXTRA_MODEL_COLORS[extra++ % EXTRA_MODEL_COLORS.length]);
  }
  return out;
}

interface ModelsSwitchboardProps {
  mainViewer: ViewerInstance | null;
  /** the main view finished loading the primary model (its bundle is in the cache by then) */
  primaryLoaded: boolean;
  entry: EntryManifest | null;
  /** the model the main view holds as its primary */
  primaryId: string | null;
  /** the model every pair metric compares against */
  referenceId: string | null;
  /** the user marks a model as the reference (null: back to the default) */
  onReference: (modelId: string | null) => void;
  /** the boxes, held by the host so that the colour board can repaint them */
  boxes: readonly SwitchboardBoxState[];
  onBoxes: Dispatch<SetStateAction<SwitchboardBoxState[]>>;
  /** the models that have a box right now, in box order */
  onBoxedModels: (modelIds: readonly string[]) => void;
  /** open the colour board on a box's column */
  onOpenColor: (targetId: string) => void;
  /** the ramp the conformer look counts in (the main view's choice) */
  ramp: ConformerRamp;
  bundles: ModelBundles;
  /** metrics of any model of the entry */
  metrics: ModelMetrics;
  /** a box shows this model: its stored residue data is wanted */
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

function isLoadable(model: ManifestModel): model is LoadableModel {
  return !!model.url && !!model.format;
}

export default function ModelsSwitchboard({
  mainViewer,
  primaryLoaded,
  entry,
  primaryId,
  referenceId,
  onReference,
  boxes,
  onBoxes: setBoxes,
  onBoxedModels,
  onOpenColor,
  ramp,
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
  const maxBoxes = Math.max(1, Math.min(HARD_MAX_BOXES, options?.maxBoxes ?? DEFAULT_MAX_BOXES));
  const [open, setOpen] = useState(options?.defaultOpen ?? true);
  const nextKey = useRef(1);
  const poseGroup = useMemo(() => createPoseGroup(), []);

  const models = useMemo(() => entry?.models ?? [], [entry]);

  // a fresh entry (or a different primary) opens with the primary model's box, alone unless
  // the host asked for every model
  const openWithAll = options?.boxes === "all";
  useEffect(() => {
    if (!primaryId) {
      setBoxes([]);
      return;
    }
    const others = openWithAll ? models.filter((m) => m.id !== primaryId && isLoadable(m)).map((m) => m.id) : [];
    setBoxes(
      [primaryId, ...others].slice(0, maxBoxes).map((modelId) => ({ key: nextKey.current++, modelId, facetId: SOURCE_GHOST })),
    );
  }, [models, primaryId, openWithAll, maxBoxes, setBoxes]);

  const modelById = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const colorById = useMemo(() => modelIdentityColors(models, primaryId), [models, primaryId]);

  const active = open && primaryLoaded;

  // the boxed models are the ones compared with one another
  useEffect(() => {
    onBoxedModels(active ? boxes.map((box) => box.modelId) : []);
  }, [active, boxes, onBoxedModels]);

  // every shown model needs its file; the primary's comes from the main view's own load
  const requestBundle = bundles.request;
  useEffect(() => {
    if (!active) return;
    for (const box of boxes) {
      onNeedStoredData(box.modelId);
      if (box.modelId === primaryId) continue;
      const model = modelById.get(box.modelId);
      if (model && isLoadable(model)) requestBundle(model);
    }
  }, [active, boxes, modelById, primaryId, requestBundle, onNeedStoredData]);

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

  // --- facets ---

  // only the metrics boxes show are computed
  const tracks = useMemo(() => {
    const out = new Map<number, { id: MetricId; track: Track }>();
    for (const box of boxes) {
      const id = metricOfSource(box.facetId);
      if (!id) continue;
      const outcome = metrics.resolve(box.modelId, id);
      if (typeof outcome !== "string") out.set(box.key, { id, track: outcome });
    }
    return out;
  }, [boxes, metrics]);

  // boxes showing the same metric share one colour domain, so their colours compare
  const domains = useMemo(() => {
    const out = new Map<MetricId, [number, number]>();
    for (const { id, track } of tracks.values()) {
      const own = displayDomain(id, track);
      const prev = out.get(id);
      out.set(id, prev ? [Math.min(prev[0], own[0]), Math.max(prev[1], own[1])] : own);
    }
    return out;
  }, [tracks]);

  const paintCache = useRef(new WeakMap<Track, { low: number; high: number; paint: TrackPaint }>());
  const paintFor = (boxKey: number): { id: MetricId; domain: [number, number]; paint: TrackPaint } | null => {
    const entryOf = tracks.get(boxKey);
    const domain = entryOf ? domains.get(entryOf.id) : undefined;
    if (!entryOf || !domain) return null;
    let cached = paintCache.current.get(entryOf.track);
    if (!cached || cached.low !== domain[0] || cached.high !== domain[1]) {
      cached = { low: domain[0], high: domain[1], paint: trackPaint(entryOf.track, domain, METRIC_UI[entryOf.id].colors) };
      paintCache.current.set(entryOf.track, cached);
    }
    return { id: entryOf.id, domain, paint: cached.paint };
  };

  const removeBox = useCallback(
    (key: number) => {
      setBoxes((prev) => prev.filter((b) => b.key !== key));
    },
    [setBoxes],
  );
  const addBox = useCallback(
    (modelId: string) => {
      setBoxes((prev) => [...prev, { key: nextKey.current++, modelId, facetId: SOURCE_GHOST }]);
    },
    [setBoxes],
  );

  if (!entry || !primaryId) return null;

  const referenceEntry = referenceId ? modelById.get(referenceId) : undefined;
  const referenceName = referenceEntry ? modelDisplayName(referenceEntry, models) : null;

  const full = boxes.length >= maxBoxes;
  const addMenu = (
    <div className="flex flex-col gap-1">
      <span className="hs-label">models of {entry.pdbId || entry.id}</span>
      <div className="flex flex-col">
      {models.map((model) => {
        const loadable = isLoadable(model);
        return (
          <button
            key={model.id}
            type="button"
            disabled={!loadable || full}
            onClick={() => addBox(model.id)}
            className="flex w-full border-b border-line px-1.5 py-1 text-left last:border-b-0 hover:bg-surface-hover flex-col items-start disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <span className="flex items-center gap-1.5 text-ink">
              {modelDisplayName(model, models)}
              {model.id === primaryId && <span className="hs-tag hs-tag-accent">main view</span>}
            </span>
            <span className="text-[10px] text-ink-muted">{loadable ? modelDetailRows(model)[0].text : modelFileLine(model)}</span>
          </button>
        );
      })}
      </div>
      {full && <span className="text-[10px] text-ink-muted">{maxBoxes} boxes at most; remove one to add another</span>}
    </div>
  );

  return (
    <div data-hetstar-part="switchboard" className="flex flex-col items-end gap-1.5">
      {/* the dock's title stripe: the fold, then the cross-model tools */}
      <div
        className={`pointer-events-auto flex h-6 items-center gap-2 pl-2.5 pr-1 text-[10.5px] text-ink-secondary ${CARD_SHELL} bg-surface-head shadow-[inset_2px_0_0_#663be4,0_6px_18px_rgba(26,30,42,0.1)]`}
      >
        <button
          type="button"
          title="show or hide the model replicas"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5"
        >
          <span className="hs-chevron" aria-hidden />
          <span className="hs-head-title">Models</span>
        </button>
        {active && (
          <span
            title="the model the others are compared against; mark another one with the ref button of its box"
            className="flex min-w-0 items-baseline gap-1"
          >
            <span className="hs-label">ref</span>
            <span className="max-w-[150px] truncate text-ink">{referenceName ?? "none"}</span>
          </span>
        )}
        {active && (
          <PinPopover content={addMenu} width={260} align="end" closeKey={boxes.length}>
            <span title="add a box for another model of this entry" className="hs-btn hs-btn-sm">
              + add
            </span>
          </PinPopover>
        )}
      </div>
      {active && (
        <div className="flex flex-wrap-reverse justify-end gap-1.5">
          {boxes.map((box) => {
            const model = modelById.get(box.modelId);
            if (!model) return null;
            const painted = paintFor(box.key);
            const mode = lookOfSource(box.facetId);
            const facet: ReplicaFacet = painted
              ? { kind: "track", paint: painted.paint }
              : mode
                ? { kind: "color", mode, ramp }
                : { kind: "ghost" };
            const legend: FacetLegend | null = painted
              ? { colors: METRIC_UI[painted.id].colors, domain: painted.domain, unit: metricUnit(painted.id) }
              : null;
            const name = modelDisplayName(model, models);
            const boxMetric = metricOfSource(box.facetId);
            const requestState = boxMetric ? metrics.requested(box.modelId, boxMetric) : null;
            const request =
              boxMetric && requestState && requestState.status !== "blocked"
                ? {
                    status: requestState.status,
                    what: `${metricLabel(boxMetric)} of ${name}`,
                    onCompute: () => metrics.compute(box.modelId, boxMetric),
                    onErase: () => metrics.erase(box.modelId, boxMetric),
                  }
                : null;
            return (
              <SwitchboardBox
                key={box.key}
                name={name}
                detail={modelDetailRows(model)}
                bundle={bundles.states.get(box.modelId)}
                color={colorById.get(box.modelId) ?? GHOST_B_COLOR}
                facetLabel={colorSourceLabel(box.facetId)}
                onOpenColor={() => onOpenColor(boxTarget(box.key))}
                facet={facet}
                legend={legend}
                request={request}
                colorThemes={preset.colorThemes}
                poseGroup={poseGroup}
                selection={selection}
                selRepOverlays={selRepOverlays}
                hoverBus={hoverBus}
                glass={glass}
                onHoverResidue={onHoverResidue}
                onNavigate={onNavigate}
                isReference={box.modelId === referenceId}
                onReference={() => onReference(box.modelId === referenceId ? null : box.modelId)}
                onRemove={boxes.length > 1 ? () => removeBox(box.key) : null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
