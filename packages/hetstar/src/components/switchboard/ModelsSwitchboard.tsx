"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import type { Track, TrackSegment } from "@dynamic-pdb/hetkit/metrics";
import type { ResidueRef } from "@dynamic-pdb/hetkit/model";
import type { ModelBundles } from "../../hooks/useModelBundles";
import type { ModelMetrics } from "../../hooks/useModelMetrics";
import { modelDetailLines, modelDisplayName } from "../../lib/dpdb/names";
import type { EntryManifest, LoadableModel, ManifestModel } from "../../lib/dpdb/types";
import type { Emitter } from "../../lib/lab/emitter";
import type { LabSelection } from "../../lib/lab/selection";
import { createPoseGroup } from "../../lib/molstar/camera-sync";
import type { ReplicaFacet, ReplicaGlass } from "../../lib/molstar/replica";
import type { RepColorMode } from "../../lib/molstar/repstyle";
import type { SelRepOverlay } from "../../lib/molstar/selrep";
import { GHOST_B_COLOR, MODEL_A_COLOR } from "../../lib/molstar/style";
import { trackPaint, type TrackPaint } from "../../lib/molstar/track-theme";
import type { MolstarViewer as ViewerInstance, PickInfo } from "../../lib/molstar/viewer";
import type { HetstarPreset } from "../../presets/types";
import { displayDomain, METRIC_ORDER, METRIC_UI, metricLabel, metricUnit, type MetricId } from "../compare/metrics";
import { COLOR_MODES } from "../compare/StyleTray";
import { CARD_SHELL, PinPopover } from "../compare/ui";
import SwitchboardBox, { type FacetLegend, type FacetOption, type HoverTarget } from "./SwitchboardBox";

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
const GHOST_FACET = "ghost";
/** identity colours of the models beside the primary and the deposited one */
const EXTRA_MODEL_COLORS = [0x9fb7a5, 0xc4a5b8, 0xa9b3cf, 0xd0b99a];
const VIEW_SPHERE_DEBOUNCE_MS = 150;

interface Box {
  key: number;
  modelId: string;
  facetId: string;
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
  /** the models that have a box right now, in box order */
  onBoxedModels: (modelIds: readonly string[]) => void;
  /** where the compared models disagree most about motion, strongest first */
  hotspots: readonly TrackSegment[];
  hotspotUnit: string;
  /** send the main view to a hotspot */
  onHotspot: (segment: TrackSegment) => void;
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

function metricOf(facetId: string): MetricId | null {
  return facetId.startsWith("metric:") ? (facetId.slice(7) as MetricId) : null;
}

export default function ModelsSwitchboard({
  mainViewer,
  primaryLoaded,
  entry,
  primaryId,
  referenceId,
  onReference,
  onBoxedModels,
  hotspots,
  hotspotUnit,
  onHotspot,
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
  const [boxes, setBoxes] = useState<Box[]>([]);
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
      [primaryId, ...others].slice(0, maxBoxes).map((modelId) => ({ key: nextKey.current++, modelId, facetId: GHOST_FACET })),
    );
  }, [models, primaryId, openWithAll, maxBoxes]);

  const modelById = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const colorById = useMemo(() => {
    const out = new Map<string, number>();
    let extra = 0;
    for (const m of models) {
      if (m.id === primaryId) out.set(m.id, MODEL_A_COLOR);
      else if (m.role === "deposited") out.set(m.id, GHOST_B_COLOR);
      else out.set(m.id, EXTRA_MODEL_COLORS[extra++ % EXTRA_MODEL_COLORS.length]);
    }
    return out;
  }, [models, primaryId]);

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

  const lookOptions = useMemo<FacetOption[]>(
    () => [
      { id: GHOST_FACET, label: "ghost", group: "look" },
      ...COLOR_MODES.filter((m) => preset.colorModes.includes(m.id)).map(
        (m): FacetOption => ({ id: `color:${m.id}`, label: m.label, group: "look" }),
      ),
    ],
    [preset.colorModes],
  );

  const metricOptionsFor = useCallback(
    (modelId: string): FacetOption[] =>
      METRIC_ORDER.map((id) => ({
        id: `metric:${id}`,
        label: metricLabel(id),
        group: "metric",
        unavailable: metrics.unavailable(modelId, id),
      })),
    [metrics],
  );

  // only the metrics boxes show are computed
  const tracks = useMemo(() => {
    const out = new Map<number, { id: MetricId; track: Track }>();
    for (const box of boxes) {
      const id = metricOf(box.facetId);
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

  const setFacet = useCallback((key: number, facetId: string) => {
    setBoxes((prev) => prev.map((b) => (b.key === key ? { ...b, facetId } : b)));
  }, []);
  const removeBox = useCallback((key: number) => {
    setBoxes((prev) => prev.filter((b) => b.key !== key));
  }, []);
  const addBox = useCallback((modelId: string) => {
    setBoxes((prev) => [...prev, { key: nextKey.current++, modelId, facetId: GHOST_FACET }]);
  }, []);

  // --- hotspots: step through them, or pick one from the list ---

  const [hotspotAt, setHotspotAt] = useState<number | null>(null);
  // a new ranking (another model boxed, another entry) starts the walk over
  useEffect(() => setHotspotAt(null), [hotspots]);
  const goToHotspot = useCallback(
    (index: number) => {
      const segment = hotspots[index];
      if (!segment) return;
      setHotspotAt(index);
      onHotspot(segment);
    },
    [hotspots, onHotspot],
  );
  const stepHotspot = (step: 1 | -1) => {
    if (!hotspots.length) return;
    const from = hotspotAt ?? (step === 1 ? -1 : 0);
    goToHotspot((from + step + hotspots.length) % hotspots.length);
  };

  if (!entry || !primaryId) return null;

  const hotspotName = (segment: TrackSegment) =>
    segment.start.seq === segment.end.seq
      ? `${segment.chain} ${segment.start.seq}`
      : `${segment.chain} ${segment.start.seq}-${segment.end.seq}`;
  const hotspotMenu = (
    <div className="flex flex-col gap-1">
      <span className="hs-label whitespace-normal">where the compared models disagree about motion</span>
      <div className="flex flex-col">
        {hotspots.map((segment, index) => (
          <button
            key={`${segment.chain}|${segment.start.seq}|${segment.end.seq}`}
            type="button"
            onClick={() => goToHotspot(index)}
            className={`flex w-full border-b border-line px-1.5 py-1 text-left last:border-b-0 hover:bg-surface-hover items-baseline justify-between gap-3 ${
              index === hotspotAt ? "bg-accent-soft shadow-[inset_2px_0_0_#663be4]" : ""
            }`}
          >
            <span className="hs-value">
              <span className="hs-unit">{index + 1} </span>
              {hotspotName(segment)}
            </span>
            <span className="hs-value text-[10px]">
              <span className="hs-unit">up to </span>
              {segment.peak.toFixed(2)}
              <span className="hs-unit"> {hotspotUnit}</span>
            </span>
          </button>
        ))}
      </div>
      <span className="text-[10px] leading-snug text-ink-muted">
        runs of polymer residues in the top tenth of the motion disagreement, ranked by their highest value
      </span>
    </div>
  );

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
            <span className="text-[10px] text-ink-muted">{loadable ? modelDetailLines(model)[0] : "no coordinate file listed"}</span>
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
        {active && hotspots.length > 0 && (
          <span className="flex items-center gap-px">
            <button
              type="button"
              title="previous hotspot"
              aria-label="previous hotspot"
              onClick={() => stepHotspot(-1)}
              className="hs-btn hs-btn-sm hs-btn-icon"
            >
              {"\u2039"}
            </button>
            <PinPopover content={hotspotMenu} width={260} align="end" closeKey={hotspotAt ?? -1}>
              <span
                title="where the compared models disagree most about motion; step through them or pick one"
                className="hs-btn hs-btn-sm tabular-nums"
              >
                hotspots
                <span className="hs-unit">
                  {hotspotAt === null ? "" : `${hotspotAt + 1}/`}
                  {hotspots.length}
                </span>
              </span>
            </PinPopover>
            <button
              type="button"
              title="next hotspot"
              aria-label="next hotspot"
              onClick={() => stepHotspot(1)}
              className="hs-btn hs-btn-sm hs-btn-icon"
            >
              {"\u203a"}
            </button>
          </span>
        )}
      </div>
      {active && (
        <div className="flex flex-wrap-reverse justify-end gap-1.5">
          {boxes.map((box) => {
            const model = modelById.get(box.modelId);
            if (!model) return null;
            const painted = paintFor(box.key);
            const mode = box.facetId.startsWith("color:") ? (box.facetId.slice(6) as RepColorMode) : null;
            const facet: ReplicaFacet = painted
              ? { kind: "track", paint: painted.paint }
              : mode
                ? { kind: "color", mode, ramp: preset.repStyle.ramp }
                : { kind: "ghost" };
            const legend: FacetLegend | null = painted
              ? { colors: METRIC_UI[painted.id].colors, domain: painted.domain, unit: metricUnit(painted.id) }
              : null;
            return (
              <SwitchboardBox
                key={box.key}
                name={modelDisplayName(model, models)}
                detail={modelDetailLines(model)}
                bundle={bundles.states.get(box.modelId)}
                color={colorById.get(box.modelId) ?? GHOST_B_COLOR}
                facetId={box.facetId}
                facetOptions={[...lookOptions, ...metricOptionsFor(box.modelId)]}
                onFacet={(id) => setFacet(box.key, id)}
                facet={facet}
                legend={legend}
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
