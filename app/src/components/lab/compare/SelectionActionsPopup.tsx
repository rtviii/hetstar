"use client";
import { useRef, useState } from "react";
import type { ResidueRange } from "@/lib/molstar/conformers";
import { altColorCss } from "@/lib/molstar/altloc-theme";
import { MAX_BOOKMARKS } from "@/lib/lab/bookmarks";
import { CARD_SHELL, SwitchButton, useDismiss } from "./ui";

// The Selection Actions Panel: opened by a (non-drag) right click, fixed at the cursor
// and clamped to the viewport. Always acts on the WHOLE current selection — one residue
// or many ranges: conformer expansion and the clip sphere generalize to every residue
// of the target. The conformer chips carry the SAME letter colors the 3D overpaint uses
// (altloc-theme's AltColors), so the panel doubles as the legend once conformers are
// shown. It opens even without a selection (target null): the pick-mode toggles at the
// top must stay reachable to switch between residue-wise and atom/bond-wise picking.

const WIDTH = 252;

export type PickMode = "residue" | "atom";

// three linked circles: a residue chain
function ResidueModeIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <path d="M3.2 5h2.6M8.2 5h2.6" />
      <circle cx="2" cy="5" r="1.5" />
      <circle cx="7" cy="5" r="1.5" />
      <circle cx="12" cy="5" r="1.5" />
    </svg>
  );
}

// two circles joined by one bond: atoms and bonds
function AtomModeIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <path d="M4.6 6.2l4.8-2.4" />
      <circle cx="3" cy="7" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="11" cy="3" r="1.8" />
    </svg>
  );
}

export type ClipMode = "off" | "density" | "all";

export interface ActionTarget {
  ranges: ResidueRange[];
  /** formatted range label ("A 15-22, 41") */
  label: string;
  /** non-water residues inside the selection */
  residueCount: number;
  /** how many of them are split into conformers */
  splitCount: number;
  /** union of altloc letters across the selection */
  letters: string[];
  /** set only when the target is a sole residue */
  compId?: string;
}

const CLIP_MODES: { id: ClipMode; label: string }[] = [
  { id: "off", label: "off" },
  { id: "density", label: "density" },
  { id: "all", label: "density + model" },
];

function ActionButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded border border-line-strong bg-surface-muted px-2 py-1 text-left text-[11.5px] text-ink-secondary hover:border-ink-muted/40 hover:bg-line disabled:cursor-default disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:bg-surface-muted"
    >
      {children}
    </button>
  );
}

export default function SelectionActionsPopup({
  anchor,
  target,
  pickMode,
  onPickMode,
  onBookmark,
  bookmarkCount,
  conformersShown,
  densityReady,
  clipMode,
  clipRadius,
  onToggleConformers,
  onClip,
  onClose,
}: {
  anchor: { x: number; y: number };
  /** null with an empty selection: only the pick-mode row renders */
  target: ActionTarget | null;
  pickMode: PickMode;
  onPickMode: (mode: PickMode) => void;
  /** save the selection as a bookmark; null when there is nothing to save or the cap is reached */
  onBookmark: (() => void) | null;
  bookmarkCount: number;
  /** residue: its conformers expanded; range: EVERY split residue in it expanded */
  conformersShown: boolean;
  densityReady: boolean;
  clipMode: ClipMode;
  clipRadius: number;
  onToggleConformers: () => void;
  /** apply (or with "off" clear) the clip sphere over the target */
  onClip: (mode: ClipMode, radius: number) => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [radius, setRadius] = useState(clipRadius);
  const [mode, setMode] = useState<ClipMode>(clipMode);

  // Escape and outside-mousedown close the panel.
  useDismiss(cardRef, true, onClose);

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 250));

  const setClip = (m: ClipMode, r: number) => {
    setMode(m);
    setRadius(r);
    onClip(m, r);
  };

  const multi = !!target && target.residueCount > 1;
  const split = !!target && target.splitCount > 0;
  const header = target ? (target.compId ? `${target.compId} ${target.label}` : target.label) : null;
  // a whole-selection clip sphere routinely needs more room than a single residue
  const maxRadius = multi ? 40 : 20;

  return (
    <div
      ref={cardRef}
      data-selection-popup
      className={`fixed z-50 flex flex-col gap-1.5 p-2 text-[11.5px] text-ink-secondary ${CARD_SHELL}`}
      style={{ left, top, width: WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10.5px] uppercase tracking-wide text-ink-muted/75">select by</span>
        <div className="flex items-center gap-1">
          <SwitchButton
            pressed={pickMode === "residue"}
            title="residue-wise selection"
            onClick={() => onPickMode("residue")}
          >
            <ResidueModeIcon />
          </SwitchButton>
          <SwitchButton
            pressed={pickMode === "atom"}
            title="atom/bond-wise selection (a bond pick takes both atoms)"
            onClick={() => onPickMode("atom")}
          >
            <AtomModeIcon />
          </SwitchButton>
        </div>
      </div>

      {target && header && (
        <div className="flex flex-col border-t border-line px-0.5 pt-1.5">
          <span className="truncate font-medium" title={header}>
            {header}
          </span>
          <span className="text-[10.5px] text-ink-muted/75">
            {multi
              ? `${target.residueCount} residues · ${target.splitCount} split`
              : split
                ? `${target.letters.length} conformers`
                : "unsplit"}
          </span>
        </div>
      )}

      {target && (
        <ActionButton
          disabled={!onBookmark}
          onClick={() => {
            onBookmark?.();
            onClose();
          }}
        >
          {onBookmark ? `bookmark selection (${bookmarkCount + 1}/${MAX_BOOKMARKS})` : `bookmarks full (${MAX_BOOKMARKS}/${MAX_BOOKMARKS})`}
        </ActionButton>
      )}

      {split && target && (
        <div className="flex flex-col gap-1 border-t border-line pt-1.5">
          <div className="flex flex-wrap items-center gap-1.5 px-0.5">
            {target.letters.map((letter) => (
              <span
                key={letter}
                className={`flex items-center gap-1 rounded border px-1 py-0.5 text-[10.5px] ${
                  conformersShown ? "border-line-strong text-ink-secondary" : "border-line text-ink-muted/75"
                }`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{ background: altColorCss(letter), opacity: conformersShown ? 1 : 0.3 }}
                />
                {letter}
              </span>
            ))}
          </div>
          <ActionButton onClick={onToggleConformers}>
            {conformersShown
              ? target.splitCount > 1
                ? `collapse conformers on ${target.splitCount} residues`
                : "collapse conformers"
              : target.splitCount > 1
                ? `show conformers on ${target.splitCount} split residues`
                : "show conformers, colored as above"}
          </ActionButton>
        </div>
      )}

      {target && (
        <div className={`flex flex-col gap-1 border-t border-line pt-1.5 ${densityReady ? "" : "opacity-40"}`}>
          <div className="px-0.5 text-[10.5px] uppercase tracking-wide text-ink-muted/75">
            {multi ? "clip around selection" : "clip around residue"}
          </div>
          <div className="flex items-center gap-1">
            {CLIP_MODES.map((m) => (
              <SwitchButton key={m.id} pressed={mode === m.id} disabled={!densityReady} onClick={() => setClip(m.id, radius)}>
                {m.label}
              </SwitchButton>
            ))}
          </div>
          <label className="flex items-center gap-2 px-0.5">
            <span className="whitespace-nowrap text-[10px] text-ink-muted">radius</span>
            <input
              type="range"
              className="min-w-0 flex-1"
              min={2}
              max={maxRadius}
              step={0.5}
              value={radius}
              disabled={!densityReady}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRadius(r);
                if (mode !== "off") onClip(mode, r);
              }}
            />
            <span className="whitespace-nowrap text-right text-[10px] tabular-nums text-ink-muted">{radius.toFixed(1)} A</span>
          </label>
        </div>
      )}
    </div>
  );
}
