"use client";
import { useEffect, useRef, useState } from "react";
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import type { ResidueRef } from "@dynamic-pdb/hetkit/model";
import type { BundleState } from "../../hooks/useModelBundles";
import { useReplicaViewer } from "../../hooks/useReplicaViewer";
import { hexCss } from "../../lib/lab/color";
import type { Emitter } from "../../lib/lab/emitter";
import type { LabSelection } from "../../lib/lab/selection";
import type { PoseGroup } from "../../lib/molstar/camera-sync";
import type { ResidueRange } from "../../lib/molstar/conformers";
import type { ReplicaFacet, ReplicaGlass } from "../../lib/molstar/replica";
import type { SelRepOverlay } from "../../lib/molstar/selrep";
import type { PickInfo } from "../../lib/molstar/viewer";
import { CARD_SHELL, Spinner, Tooltip } from "../compare/ui";

export interface FacetOption {
  id: string;
  label: string;
  group: "look" | "metric";
  /** why the facet cannot be shown for this model; it is listed disabled */
  unavailable?: string | null;
}

/** the colour scale of a metric facet, for the strip under the box */
export interface FacetLegend {
  colors: number[];
  domain: [number, number];
  unit: string;
}

/** residues hovered anywhere in the viewer (null: nothing hovered) */
export type HoverTarget = readonly ResidueRange[] | null;

interface SwitchboardBoxProps {
  name: string;
  detail: string[];
  /** undefined until the model's file has been asked for */
  bundle: BundleState | undefined;
  color: number;
  facetId: string;
  facetOptions: FacetOption[];
  onFacet: (id: string) => void;
  facet: ReplicaFacet;
  legend: FacetLegend | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colorThemes: readonly ColorTheme.Provider<any, any>[];
  poseGroup: PoseGroup;
  selection: LabSelection;
  selRepOverlays: readonly SelRepOverlay[];
  hoverBus: Emitter<HoverTarget>;
  glass: ReplicaGlass | null;
  onHoverResidue: (ref: ResidueRef | null) => void;
  onNavigate: (pick: PickInfo) => void;
  /** the other models are compared against this one */
  isReference: boolean;
  onReference: () => void;
  onRemove: (() => void) | null;
}

function formatBound(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
}

export default function SwitchboardBox({
  name,
  detail,
  bundle,
  color,
  facetId,
  facetOptions,
  onFacet,
  facet,
  legend,
  colorThemes,
  poseGroup,
  selection,
  selRepOverlays,
  hoverBus,
  glass,
  onHoverResidue,
  onNavigate,
  isReference,
  onReference,
  onRemove,
}: SwitchboardBoxProps) {
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

  // the pose group frames the box on its model and keeps it turned like every other view
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
    viewer.setModel(ready ? { key: ready.model.id, text: ready.text, split: ready.split, color } : null);
  }, [viewer, ready, color]);

  // a facet is re-applied only when what it paints changed, not whenever its object did
  const facetRef = useRef(facet);
  facetRef.current = facet;
  const facetKey = facet.kind === "color" ? `${facet.mode}|${facet.ramp}` : facet.kind;
  const paint = facet.kind === "track" ? facet.paint : null;
  useEffect(() => {
    viewer?.setFacet(facetRef.current);
  }, [viewer, facetKey, paint]);

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
  const looks = facetOptions.filter((o) => o.group === "look");
  const metrics = facetOptions.filter((o) => o.group === "metric");

  return (
    <div className={`pointer-events-auto flex w-40 flex-col overflow-hidden ${CARD_SHELL}`}>
      <div className="flex h-[22px] items-center gap-1 border-b border-line pl-1.5 pr-0.5 text-[10.5px] text-ink">
        <span className="hs-pip" style={{ background: hexCss(color) }} />
        <Tooltip
          content={
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-ink">{name}</span>
              {detail.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>
          }
        >
          <span className="block max-w-[84px] truncate">{name}</span>
        </Tooltip>
        <button
          type="button"
          title={
            isReference
              ? "the other models are compared against this one; click to go back to the default reference"
              : "compare the other models against this one"
          }
          onClick={onReference}
          aria-pressed={isReference}
          className={`hs-btn hs-btn-sm ml-auto ${isReference ? "" : "hs-btn-quiet"}`}
        >
          ref
        </button>
        {onRemove && (
          <button
            type="button"
            title="remove this box"
            aria-label="remove this box"
            onClick={onRemove}
            className="hs-btn hs-btn-sm hs-btn-icon hs-btn-quiet"
          >
            {"×"}
          </button>
        )}
      </div>
      <div className="relative h-32 w-full bg-white" onContextMenu={(e) => e.preventDefault()}>
        <div ref={containerRef} className="absolute inset-0" />
        {busy && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner className="h-3.5 w-3.5" />
          </div>
        )}
        {problem && (
          <div className="absolute inset-0 overflow-hidden bg-white/90 p-1.5 text-[10px] leading-snug text-danger">{problem}</div>
        )}
      </div>
      {legend && (
        <div className="flex items-center gap-1 border-t border-line px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-ink-muted">
          <span>{formatBound(legend.domain[0])}</span>
          <span
            className="h-1.5 flex-1"
            style={{ background: `linear-gradient(to right, ${legend.colors.map(hexCss).join(", ")})` }}
          />
          <span>
            {formatBound(legend.domain[1])}
            {legend.unit ? ` ${legend.unit}` : ""}
          </span>
        </div>
      )}
      <select
        title="what the replica is painted with"
        className="h-[22px] border-0 border-t border-line bg-transparent px-1 font-mono text-[10px] text-ink-secondary hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
        value={facetId}
        onChange={(e) => onFacet(e.target.value)}
      >
        {looks.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {metrics.length > 0 && (
          <optgroup label="metrics">
            {metrics.map((o) => (
              <option key={o.id} value={o.id} disabled={!!o.unavailable} title={o.unavailable ?? undefined}>
                {o.unavailable ? `${o.label} (${o.unavailable})` : o.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
