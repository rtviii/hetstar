"use client";
import { memo, useMemo } from "react";

import { refAt } from "@dynamic-pdb/hetkit/model";
import { rampCss } from "@/lib/lab/color";
import { metricValues } from "./PlotLanes";
import type { LaneModule, LaneProps } from "./types";

// The residues themselves, with the level of detail the room per residue allows: a
// letter where one is legible, otherwise one dot per residue, and once the dots would
// touch a repeating background tile instead of thousands of elements. Residues the shown
// model has no atoms for are drawn faint. (The scheme follows Dynamic PDB's viewer.)
// The host's color-by choice paints each cell's background with that metric's ramp.

const LETTERS_FROM = 5;
const DOTS_FROM = 1.5;

const SequenceLaneView = memo(function SequenceLaneView({ ctx, view }: LaneProps) {
  const { chain, colorBy } = ctx;
  const cell = view.cell;
  const mode = cell < DOTS_FROM ? "dense" : cell >= LETTERS_FROM ? "letters" : "dots";
  const dot = Math.max(1, Math.min(3, Math.round(cell / 2)));
  const fontSize = Math.max(6, Math.min(Math.round(cell * 1.15), 12));

  // per-position cell background from the color-by metric, softened so letters stay legible
  const shade = useMemo(() => {
    if (!colorBy) return null;
    const values = metricValues(chain, colorBy);
    const [d0, d1] = colorBy.domain;
    const span = d1 - d0;
    return Array.from(values, (v) => {
      if (Number.isNaN(v)) return undefined;
      const t = span > 0 ? Math.max(0, Math.min(1, (v - d0) / span)) : 0.5;
      return `color-mix(in srgb, ${rampCss(colorBy.colors, t)} 55%, white)`;
    });
  }, [chain, colorBy]);

  if (mode === "dense") {
    return (
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: `radial-gradient(circle ${dot}px at 50% 50%, #3d414f 99%, transparent 100%)`,
          backgroundRepeat: "repeat-x",
          backgroundPosition: "0 50%",
          backgroundSize: `calc(100% / ${Math.max(1, chain.length)}) 100%`,
        }}
      />
    );
  }
  return (
    <div className="absolute inset-0 flex items-center">
      {chain.positions.map((p) => (
        <span
          key={p.pos}
          className={`flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden text-center font-mono font-semibold uppercase leading-none ${
            p.observed ? "text-ink" : "text-ink-muted/40"
          }`}
          style={{
            ...(mode === "letters" ? { fontSize } : null),
            backgroundColor: shade?.[p.pos - 1],
          }}
        >
          {mode === "letters" ? (
            p.letter
          ) : (
            <span
              className="mx-auto block rounded-full bg-ink-secondary"
              style={{ width: dot, height: dot, opacity: p.observed ? 0.8 : 0.3 }}
            />
          )}
        </span>
      ))}
    </div>
  );
});

export const sequenceLane: LaneModule = {
  id: "sequence",
  label: "Sequence",
  description: "one-letter residues of the chain; faint where the shown model has no atoms",
  defaultOn: true,
  height: 18,
  unavailable: () => null,
  Component: SequenceLaneView,
  readout: (ctx, pos) => {
    const p = ctx.chain.positions[pos - 1];
    if (!p) return null;
    const ref = refAt(ctx.chain, pos);
    const where = ref ? `${ref.chain}/${ref.seq}${ref.ins}` : "no author number";
    return `${p.compId} ${where} (pos ${pos})${p.observed ? "" : ", not modelled"}`;
  },
};
