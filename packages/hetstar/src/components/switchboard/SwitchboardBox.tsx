"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import type { ResidueRef } from "@dynamic-pdb/hetkit/model";
import type { BundleState } from "../../hooks/useModelBundles";
import { useReplicaViewer } from "../../hooks/useReplicaViewer";
import { hexCss } from "../../lib/lab/color";
import type { Emitter } from "../../lib/lab/emitter";
import { conformerPlanOf } from "../../lib/lab/model-bundle";
import type { LabSelection } from "../../lib/lab/selection";
import type { ModelLook } from "../../lib/molstar/appearance";
import type { PoseGroup } from "../../lib/molstar/camera-sync";
import type { ResidueRange } from "../../lib/molstar/conformers";
import type { ReplicaGlass } from "../../lib/molstar/replica";
import type { SelRepOverlay } from "../../lib/molstar/selrep";
import type { PickInfo } from "../../lib/molstar/viewer";
import { EyeIcon, EyeOffIcon, MainViewIcon, ReplicaIcon } from "../compare/icons";
import { CARD_SHELL, PrismMark, Spinner, Tooltip } from "../compare/ui";

/** residues hovered anywhere in the viewer (null: nothing hovered) */
export type HoverTarget = readonly ResidueRange[] | null;

/** what the replica canvas needs besides its model */
export interface ReplicaWiring {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colorThemes: readonly ColorTheme.Provider<any, any>[];
  poseGroup: PoseGroup;
  selection: LabSelection;
  selRepOverlays: readonly SelRepOverlay[];
  hoverBus: Emitter<HoverTarget>;
  glass: ReplicaGlass | null;
  onHoverResidue: (ref: ResidueRef | null) => void;
  onNavigate: (pick: PickInfo) => void;
}

// The model alone in a small canvas of its own, turned like the main view. It carries the
// main view's selection, overrides and hover, and marks the region the main view is on.
function ReplicaCanvas({
  bundle,
  color,
  look,
  computing,
  wiring,
}: {
  bundle: BundleState | undefined;
  color: number;
  look: ModelLook;
  /** the metric being computed for this replica, by name; null when none is */
  computing: string | null;
  wiring: ReplicaWiring;
}) {
  const { colorThemes, poseGroup, selection, selRepOverlays, hoverBus, glass, onHoverResidue, onNavigate } = wiring;
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewer, error: viewerError } = useReplicaViewer(containerRef, colorThemes);
  const [renderError, setRenderError] = useState<string | null>(null);
  useEffect(() => {
    if (!viewer) return;
    viewer.onError = setRenderError;
    return () => {
      viewer.onError = null;
    };
  }, [viewer]);

  // the pose group frames the replica on its model and keeps it turned like every other view
  useEffect(() => {
    const camera = viewer?.camera;
    if (!viewer || !camera) return;
    const member = poseGroup.join(camera, { fitted: () => viewer.fitSphere });
    viewer.onLoaded = () => member.refit();
    const container = containerRef.current;
    const observer = new ResizeObserver(() => {
      viewer.handleResize();
      member.refit();
    });
    if (container) observer.observe(container);
    return () => {
      viewer.onLoaded = null;
      observer.disconnect();
      member.leave();
    };
  }, [viewer, poseGroup]);

  const ready = bundle?.status === "ready" ? bundle.bundle : null;
  useEffect(() => {
    if (!viewer) return;
    viewer.setModel(
      ready ? { key: ready.model.id, text: ready.text, split: ready.split, color, plan: conformerPlanOf(ready) } : null,
    );
  }, [viewer, ready, color]);

  // a look is re-applied only when what it shows changed, not whenever its object did
  const lookRef = useRef(look);
  lookRef.current = look;
  const paint = look.paint;
  const paintKey = paint.kind === "color" ? `${paint.mode}|${paint.ramp}` : paint.kind;
  const track = paint.kind === "track" ? paint.paint : null;
  useEffect(() => {
    viewer?.setLook(lookRef.current);
  }, [viewer, look.rep, look.het, look.ions, paintKey, track]);

  useEffect(() => {
    viewer?.setSelection(selection);
  }, [viewer, selection]);

  useEffect(() => {
    viewer?.setSelRep(selRepOverlays);
  }, [viewer, selRepOverlays]);

  useEffect(() => {
    viewer?.setGlass(glass);
  }, [viewer, glass]);

  useEffect(() => {
    if (!viewer) return;
    return hoverBus.subscribe((ranges) => viewer.highlight(ranges));
  }, [viewer, hoverBus]);

  useEffect(() => {
    if (!viewer) return;
    let lastKey: string | null = null;
    const offHover = viewer.subscribeToHover((info) => {
      const key = info ? `${info.chainId}|${info.authSeqId}|${info.insCode}` : null;
      if (key === lastKey) return;
      lastKey = key;
      onHoverResidue(info ? { chain: info.chainId, seq: info.authSeqId, ins: info.insCode } : null);
    });
    const offClick = viewer.subscribeToClick((info, meta) => {
      if (info && meta.button === 1) onNavigate(info);
    });
    return () => {
      offHover();
      offClick();
    };
  }, [viewer, onHoverResidue, onNavigate]);

  const problem = viewerError ?? renderError ?? (bundle?.status === "error" ? bundle.message : null);
  const busy = !problem && (!viewer || !ready);

  return (
    <div className="relative h-32 w-full border-b border-line bg-white" onContextMenu={(e) => e.preventDefault()}>
      <div ref={containerRef} className="absolute inset-0" />
      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner className="h-3.5 w-3.5" />
        </div>
      )}
      {computing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40">
          <PrismMark size={28} label={`computing ${computing}`} />
        </div>
      )}
      {problem && (
        <div className="absolute inset-0 overflow-hidden bg-white/90 p-1.5 text-[10px] leading-snug text-danger">{problem}</div>
      )}
    </div>
  );
}

export interface ModelFact {
  label: string;
  text: string;
  /** a fact that should not be read past (a model off the main model's frame) */
  warn?: boolean;
}

interface ModelCardProps {
  name: string;
  /** what the catalogue records about the model, as labelled facts (the name's tooltip) */
  detail: readonly { label: string; text: string }[];
  /** what the card says about the model at a glance */
  facts: readonly ModelFact[];
  color: number;
  /** its coordinate file can be loaded at all */
  loadable: boolean;
  /** undefined until the model's file has been asked for */
  bundle: BundleState | undefined;
  isMain: boolean;
  /** asked to become the main view, waiting for its file or for the maps */
  mainPending: boolean;
  onMain: () => void;
  sceneVisible: boolean;
  onSceneVisible: () => void;
  /** the other models are compared against this one */
  isReference: boolean;
  onReference: () => void;
  replica: boolean;
  /** another replica can be switched on (each is a WebGL context; the browser caps them) */
  replicaAllowed: boolean;
  onReplica: () => void;
  look: ModelLook;
  computing: string | null;
  wiring: ReplicaWiring;
}

// One model of the entry in the Models Switchboard: what it is, its replica when that is on,
// and the switches that place it in the viewer (main view, drawn behind it, reference).
export default function ModelCard({
  name,
  detail,
  facts,
  color,
  loadable,
  bundle,
  isMain,
  mainPending,
  onMain,
  sceneVisible,
  onSceneVisible,
  isReference,
  onReference,
  replica,
  replicaAllowed,
  onReplica,
  look,
  computing,
  wiring,
}: ModelCardProps) {
  const loading = bundle?.status === "loading";
  return (
    <div className={`hs-dense pointer-events-auto flex w-48 flex-col overflow-hidden ${CARD_SHELL}`} data-main={isMain}>
      <div className="flex h-[22px] items-center gap-1 border-b border-line pl-1.5 pr-1 text-[10.5px] text-ink">
        <span className="hs-pip" style={{ background: hexCss(color) }} />
        <Tooltip content={{ title: name, rows: detail }}>
          <span className="block max-w-[136px] truncate">{name}</span>
        </Tooltip>
        {isMain && <span className="hs-tag hs-tag-accent ml-auto">main</span>}
        {!isMain && (loading || mainPending) && <Spinner className="ml-auto h-3 w-3" />}
      </div>
      {replica && loadable && <ReplicaCanvas bundle={bundle} color={color} look={look} computing={computing} wiring={wiring} />}
      <div className="flex h-[22px] items-center gap-px border-b border-line px-1">
        <button
          type="button"
          className={`hs-btn hs-btn-sm hs-btn-icon ${isMain ? "" : "hs-btn-quiet"}`}
          aria-pressed={isMain}
          disabled={!loadable}
          title={
            isMain
              ? "this model is the main view: picks, the lanes and the conformer tools act on it"
              : mainPending
                ? "becomes the main view as soon as its file and the maps are in"
                : "make this model the main view; the others stand behind it as ghosts"
          }
          aria-label={`make ${name} the main view`}
          onClick={onMain}
        >
          <MainViewIcon />
        </button>
        <button
          type="button"
          className={`hs-btn hs-btn-sm hs-btn-icon ${sceneVisible ? "" : "hs-btn-quiet"}`}
          aria-pressed={sceneVisible}
          disabled={!loadable}
          title={sceneVisible ? "drawn in the main view; click to hide it there" : "not drawn in the main view; click to show it there"}
          aria-label={`${sceneVisible ? "hide" : "show"} ${name} in the main view`}
          onClick={onSceneVisible}
        >
          {sceneVisible ? <EyeIcon /> : <EyeOffIcon />}
        </button>
        <button
          type="button"
          className={`hs-btn hs-btn-sm hs-btn-icon ${replica ? "" : "hs-btn-quiet"}`}
          aria-pressed={replica}
          disabled={!loadable || (!replica && !replicaAllowed)}
          title={
            replica
              ? "its replica is on: the model alone, turned like the main view; click to fold it away"
              : replicaAllowed
                ? "show its replica: the model alone, turned like the main view"
                : "no more replicas at once; fold one away first"
          }
          aria-label={`${replica ? "hide" : "show"} the replica of ${name}`}
          onClick={onReplica}
        >
          <ReplicaIcon />
        </button>
        <button
          type="button"
          className={`hs-btn hs-btn-sm ml-auto ${isReference ? "" : "hs-btn-quiet"}`}
          aria-pressed={isReference}
          disabled={!loadable}
          title={
            isReference
              ? "the other models are compared against this one; click to go back to the default reference"
              : "compare the other models against this one"
          }
          onClick={onReference}
        >
          ref
        </button>
      </div>
      <dl className="hs-kv px-1.5 py-1" style={{ ["--hs-kv-key" as string]: "52px" }}>
        {facts.map((fact) => (
          <Fragment key={fact.label}>
            <dt>{fact.label}</dt>
            <dd className={fact.warn ? "text-danger" : undefined}>{fact.text}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
