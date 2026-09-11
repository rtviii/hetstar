"use client";
import { memo, useMemo } from "react";

import { refAt, unobservedSpans } from "@dynamic-pdb/hetkit/model";
import type { ChainSequence } from "@dynamic-pdb/hetkit/model";
import { spanStyle, type LaneModule, type LaneProps, type PositionSpan } from "./types";

// Span lanes: colored ranges along the sequence, clickable to select the whole range.
// Colors are RCSB's for the same rows (helix #e43372, strand #f1d23b, unmodelled
// #cccccc, all at half opacity), as on dynamicpdb.com, so a reader coming from either
// site reads these the same way.

function authRange(chain: ChainSequence, span: PositionSpan): string {
  const a = refAt(chain, span.start);
  const b = refAt(chain, span.end);
  return a && b ? `${a.chain}/${a.seq}${a.ins}-${b.seq}${b.ins}` : `pos ${span.start}-${span.end}`;
}

function Feature({
  chain,
  span,
  color,
  title,
  onSelectSpan,
}: {
  chain: ChainSequence;
  span: PositionSpan;
  color: string;
  title: string;
  onSelectSpan: (span: PositionSpan) => void;
}) {
  return (
    <span
      className="absolute inset-y-0 cursor-pointer opacity-50 hover:opacity-80"
      style={{ ...spanStyle(span, chain.length), background: color, minWidth: 2 }}
      title={`${title} ${authRange(chain, span)}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSelectSpan(span);
      }}
    />
  );
}

const SecondaryLaneView = memo(function SecondaryLaneView({ ctx, onSelectSpan }: LaneProps) {
  return (
    <>
      {(ctx.secondary ?? []).map((s, i) => (
        <Feature
          key={i}
          chain={ctx.chain}
          span={s}
          color={s.kind === "helix" ? "#e43372" : "#f1d23b"}
          title={s.kind}
          onSelectSpan={onSelectSpan}
        />
      ))}
    </>
  );
});

export const secondaryLane: LaneModule = {
  id: "secondary",
  label: "2° structure",
  description: "helices (pink) and strands (yellow) from the deposited file's records; click one to select it",
  defaultOn: false,
  height: 12,
  unavailable: (ctx) => (ctx.secondary && ctx.secondary.length ? null : "no secondary-structure records in the source file"),
  Component: SecondaryLaneView,
  readout: (ctx, pos) => {
    const s = ctx.secondary?.find((x) => pos >= x.start && pos <= x.end);
    return s ? s.kind : null;
  },
};

const UnobservedLaneView = memo(function UnobservedLaneView({ ctx, onSelectSpan }: LaneProps) {
  const spans = useMemo(() => unobservedSpans(ctx.chain), [ctx.chain]);
  return (
    <>
      {spans.map((s, i) => (
        <Feature key={i} chain={ctx.chain} span={s} color="#cccccc" title="not modelled" onSelectSpan={onSelectSpan} />
      ))}
    </>
  );
});

export const unobservedLane: LaneModule = {
  id: "unobserved",
  label: "Unobserved",
  description: "residues of the sequence the shown model has no atoms for",
  defaultOn: false,
  height: 12,
  unavailable: (ctx) => (unobservedSpans(ctx.chain).length ? null : "every residue of this chain is modelled"),
  Component: UnobservedLaneView,
};
