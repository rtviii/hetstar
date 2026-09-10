"use client";
import { memo } from "react";

import { refAt } from "@dynamic-pdb/hetkit/model";
import type { LaneModule, LaneProps } from "./types";

// The residues themselves, with the level of detail the room per residue allows: a
// letter where one is legible, otherwise one dot per residue, and once the dots would
// touch a repeating background tile instead of thousands of elements. Residues the shown
// model has no atoms for are drawn faint. (The scheme follows Dynamic PDB's viewer.)

const LETTERS_FROM = 8;
const DOTS_FROM = 1.5;

const SequenceLaneView = memo(function SequenceLaneView({ ctx, view }: LaneProps) {
  const { chain } = ctx;
  const cell = view.cell;
  const mode = cell < DOTS_FROM ? "dense" : cell >= LETTERS_FROM ? "letters" : "dots";
  const dot = Math.max(1, Math.min(3, Math.round(cell / 2)));
  const fontSize = Math.max(7, Math.min(Math.floor(cell) - 2, 12));

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
          className={`min-w-0 flex-1 overflow-hidden text-center font-mono font-semibold uppercase leading-none ${
            p.observed ? "text-ink" : "text-ink-muted/40"
          }`}
          style={mode === "letters" ? { fontSize } : undefined}
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
  label: "sequence",
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
