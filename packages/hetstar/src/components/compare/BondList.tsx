"use client";
import { useState } from "react";
import { isWaterEnd, type BondEndInfo, type BondPair } from "../../lib/molstar/interactions";
import { altColorCss } from "../../lib/molstar/altloc-theme";
import { TinyText } from "./ui";

// Bond chips, ported from tubulinxyz: one three-segment pill per residue pair —
// residue | bond-type | residue — mono labels, hover highlights the pair in 3D,
// click focuses the camera on it. Over BOND_INLINE_MAX pairs the list collapses
// into a count toggle with a scrollable drawer.
//
// Each row can carry conformer/ensemble annotations: colored letter badges say which
// altloc conformers form the bond (no badge = shared atoms, present in every conformer),
// an amber edge marks bonds missing from at least one conformer, a k/N tag counts the
// ensemble members forming it, and grayed "ghost" rows are bonds seen only in OTHER
// members of the ensemble, not the current frame.

const BOND_INLINE_MAX = 10;

/** one displayable bond with its conformer/ensemble annotations, host-derived */
export interface BondRow {
  pair: BondPair;
  /** the bond exists under some but not all conformers of its residues */
  dependent: boolean;
  /** ensemble members forming this bond, null when no ensemble data */
  presentIn: number | null;
  memberCount: number | null;
  /** absent from the current member — exists only in other ensemble members */
  ghost: boolean;
}

/** Mol*'s long interaction names -> compact tags */
const SHORT_TYPE: Record<string, string> = {
  "Hydrogen Bond": "H-bond",
  "Weak Hydrogen Bond": "wk H-bond",
  "Ionic Interaction": "ionic",
  "Hydrophobic Contact": "hydrophobic",
  "Cation-Pi Interaction": "cat-pi",
  "Pi Stacking": "pi stack",
  "Halogen Bond": "halogen",
  "Metal Coordination": "metal",
  "Water Bridge": "water bridge",
  "Unknown Interaction": "contact",
};

function shortType(type: string): string {
  return SHORT_TYPE[type] ?? type.toLowerCase();
}

function endLabel(e: BondEndInfo, withChain: boolean): string {
  return withChain ? `${e.chain}·${e.comp}${e.seq}` : `${e.comp}${e.seq}`;
}

// water partners scan apart from residue partners
function endClass(e: BondEndInfo): string {
  return `px-1 py-[2px] hover:bg-accent-soft hover:text-accent ${isWaterEnd(e) ? "text-sky-600" : "text-ink-secondary"}`;
}

function BondChip({
  row,
  withChain,
  onHover,
  onFocus,
}: {
  row: BondRow;
  withChain: boolean;
  onHover: (pair: BondPair | null) => void;
  onFocus: (pair: BondPair) => void;
}) {
  const { pair } = row;
  const partial = row.presentIn != null && row.memberCount != null && row.presentIn < row.memberCount;
  const titleNotes = [
    pair.alts.length ? `conformer${pair.alts.length > 1 ? "s" : ""} ${pair.alts.join(", ")} only` : "",
    row.dependent ? "missing in some conformers" : "",
    partial ? `in ${row.presentIn}/${row.memberCount} ensemble members` : "",
    row.ghost ? "not formed in the current member" : "",
  ]
    .filter(Boolean)
    .join("; ");
  return (
    <span
      className={`inline-flex cursor-pointer items-center overflow-hidden rounded border font-mono text-[10px] leading-none transition-colors hover:border-accent/40 ${
        row.dependent ? "border-amber-400/70" : "border-line/70"
      } ${row.ghost ? "opacity-50" : ""}`}
      onMouseEnter={() => onHover(pair)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onFocus(pair)}
      title={`${pair.a.chain}/${pair.a.comp} ${pair.a.seq} — ${pair.type} — ${pair.b.chain}/${pair.b.comp} ${pair.b.seq}${
        titleNotes ? ` (${titleNotes})` : ""
      } (click to focus)`}
    >
      <span className={endClass(pair.a)}>
        {endLabel(pair.a, withChain)}
      </span>
      <span className="border-x border-line/50 bg-surface-muted/60 px-[3px] py-[2px] font-sans text-[9px] text-ink-muted/80">
        {shortType(pair.type)}
      </span>
      <span className={endClass(pair.b)}>
        {endLabel(pair.b, withChain)}
      </span>
      {pair.alts.length > 0 && (
        <span className="flex gap-[2px] border-l border-line/50 px-[3px] py-[2px] font-semibold">
          {pair.alts.map((l) => (
            <span key={l} style={{ color: altColorCss(l) }}>
              {l}
            </span>
          ))}
        </span>
      )}
      {partial && (
        <span className="border-l border-line/50 px-[3px] py-[2px] text-[9px] text-ink-muted/80 tabular-nums">
          {row.presentIn}/{row.memberCount}
        </span>
      )}
    </span>
  );
}

export default function BondList({
  rows,
  onHover,
  onFocus,
}: {
  rows: BondRow[];
  onHover: (pair: BondPair | null) => void;
  onFocus: (pair: BondPair) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!rows.length) return <TinyText>no non-covalent bonds touch the selection</TinyText>;

  const chains = new Set<string>();
  for (const r of rows) {
    chains.add(r.pair.a.chain);
    chains.add(r.pair.b.chain);
  }
  const withChain = chains.size > 1;

  const chips = (list: BondRow[]) => (
    <div className="flex flex-wrap gap-[3px]">
      {list.map((r) => (
        <BondChip
          key={`${r.pair.a.chain}${r.pair.a.seq}-${r.pair.b.chain}${r.pair.b.seq}-${r.pair.type}`}
          row={r}
          withChain={withChain}
          onHover={onHover}
          onFocus={onFocus}
        />
      ))}
    </div>
  );

  if (rows.length <= BOND_INLINE_MAX) return chips(rows);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="self-start rounded border border-line-strong bg-white/70 px-1.5 py-px text-[10.5px] text-ink-secondary transition-colors hover:bg-line"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {rows.length} bonds {open ? "▴" : "▾"}
      </button>
      {open && <div className="max-h-[140px] overflow-y-auto pr-1">{chips(rows)}</div>}
    </div>
  );
}
