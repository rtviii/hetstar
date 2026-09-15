"use client";
import { memo } from "react";

import type { AnnotationSpan } from "@/lib/annotations/pdbe";
import { spanStyle, type LaneContext, type LaneModule, type LaneProps } from "./types";

// PDBe annotation lanes: colored blocks for SIFTS domain mappings (Pfam, CATH, SCOP,
// InterPro) and one-position marks for binding-site membership and modified residues.
// The data lives in ctx.annotations (host-fetched once per entry, pdbe.ts); a lane here
// only reads its own source and chain. Overlapping domains are packed greedily into
// sub-rows, and the lane's height follows the packing.

const ROW_H = 10;

type Packed = { spans: (AnnotationSpan & { row: number })[]; rows: number };
const packCache = new WeakMap<AnnotationSpan[], Packed>();

/** first-fit sub-row packing; spans arrive sorted by start */
function pack(spans: AnnotationSpan[]): Packed {
  const hit = packCache.get(spans);
  if (hit) return hit;
  const rowEnds: number[] = [];
  const placed = spans.map((s) => {
    let row = rowEnds.findIndex((end) => end < s.start);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(s.end);
    } else {
      rowEnds[row] = s.end;
    }
    return { ...s, row };
  });
  const out = { spans: placed, rows: Math.max(1, rowEnds.length) };
  packCache.set(spans, out);
  return out;
}

/** this lane's spans on this chain; "loading"/null pass through, [] = fetched but none here */
function spansFor(source: string, ctx: LaneContext): AnnotationSpan[] | "loading" | null | "no-source" {
  const ann = ctx.annotations;
  if (ann === "loading" || ann === null) return ann;
  const byChain = ann.get(source);
  if (!byChain) return "no-source";
  return byChain.get(ctx.chain.chain) ?? [];
}

function annotationLaneView(source: string) {
  return memo(function AnnotationLaneView({ ctx, view, onSelectSpan }: LaneProps) {
    const spans = spansFor(source, ctx);
    if (!Array.isArray(spans) || spans.length === 0) return null;
    const packed = pack(spans);
    return (
      <>
        {packed.spans.map((s, i) => {
          const widthPx = (s.end - s.start + 1) * view.cell;
          return (
            <span
              key={i}
              className="absolute cursor-pointer overflow-hidden whitespace-nowrap rounded-[2px] opacity-80 hover:opacity-100"
              style={{
                ...spanStyle(s, ctx.chain.length),
                top: s.row * ROW_H + 1,
                height: ROW_H - 2,
                background: s.color,
                minWidth: 2,
              }}
              title={`${s.label} (${s.id})`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelectSpan(s, { additive: e.shiftKey });
              }}
            >
              {widthPx >= 24 && (
                <span className="px-1 text-[7.5px] leading-[8px] text-white">{s.label}</span>
              )}
            </span>
          );
        })}
      </>
    );
  });
}

export function makeAnnotationLane(
  source: string,
  label: string,
  description: string,
  kind: "span" | "mark",
): LaneModule {
  return {
    id: `ann:${source}`,
    label,
    description,
    defaultOn: false,
    height: (ctx) => {
      const spans = spansFor(source, ctx);
      return (Array.isArray(spans) && spans.length ? pack(spans).rows : 1) * ROW_H + 2;
    },
    unavailable: (ctx) => {
      const spans = spansFor(source, ctx);
      if (spans === null) return "needs a wwPDB entry id";
      if (spans === "loading") return "fetching from PDBe...";
      if (spans === "no-source") return `PDBe lists no ${label} for this entry`;
      if (!spans.length) return "none on this chain";
      return null;
    },
    Component: annotationLaneView(source),
    readout:
      kind === "span"
        ? (ctx, pos) => {
            const spans = spansFor(source, ctx);
            if (!Array.isArray(spans)) return null;
            const hit = spans.find((s) => pos >= s.start && pos <= s.end);
            return hit ? hit.label : null;
          }
        : (ctx, pos) => {
            const spans = spansFor(source, ctx);
            if (!Array.isArray(spans)) return null;
            const hits = spans.filter((s) => pos >= s.start && pos <= s.end);
            return hits.length ? hits.map((h) => h.label).join("; ") : null;
          },
  };
}

export const ANNOTATION_LANES: readonly LaneModule[] = [
  makeAnnotationLane("pfam", "Pfam", "Pfam family assignments from PDBe's SIFTS mappings; click a block to select its span", "span"),
  makeAnnotationLane("cath", "CATH", "CATH domain assignments from PDBe's SIFTS mappings", "span"),
  makeAnnotationLane("scop", "SCOP", "SCOP domain assignments from PDBe's SIFTS mappings", "span"),
  makeAnnotationLane("interpro", "InterPro", "InterPro entry assignments from PDBe's SIFTS mappings", "span"),
  makeAnnotationLane("modified", "Modified residues", "modified amino acids / nucleotides from PDBe", "mark"),
];
