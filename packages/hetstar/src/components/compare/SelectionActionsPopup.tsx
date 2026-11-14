"use client";
import { useRef, useState, type ReactNode } from "react";
import type { ResidueRange } from "../../lib/molstar/conformers";
import type { RepType } from "../../lib/molstar/repstyle";
import { altColorCss } from "../../lib/molstar/altloc-theme";
import { CARD_SHELL, IconButton, Segmented, SwitchButton, Tooltip, useDismiss } from "./ui";
import { AtomModeIcon, BondsIcon, ConformersIcon, ResidueModeIcon, RulerIcon, SpreadIcon } from "./icons";

// The Selection Actions Panel: opened by a (non-drag) right click, fixed at the cursor
// and clamped to the viewport. Always acts on the WHOLE current selection — one residue
// or many ranges: conformer expansion, the clip sphere and the distance tools generalize
// to every residue of the target. The conformer chips carry the SAME letter colors the
// 3D overpaint uses (altloc-theme's AltColors), so the panel doubles as the legend once
// conformers are shown. It opens even without a selection (target null): the pick-mode
// toggles at the top must stay reachable. Compact by design: icon buttons explained by
// Tooltip, no inline prose.

const WIDTH = 240;

export type PickMode = "residue" | "atom" | "measure";

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

function Heading({ children }: { children: ReactNode }) {
  return <div className="hs-label">{children}</div>;
}

export default function SelectionActionsPopup({
  anchor,
  target,
  pickMode,
  onPickMode,
  onCreateLocus,
  conformersShown,
  mutedLetters,
  onToggleLetter,
  densityReady,
  clipMode,
  clipRadius,
  onToggleConformers,
  onClip,
  onClose,
  onConformerSpread,
  bondsReady,
  bondCount,
  showBonds3d,
  onShowBonds3d,
  selRep,
  onSelRep,
  measureCount,
  onClearMeasurements,
  onResetAll,
}: {
  anchor: { x: number; y: number };
  /** null with an empty selection: only the header row renders */
  target: ActionTarget | null;
  pickMode: PickMode;
  onPickMode: (mode: PickMode) => void;
  /** set the selection apart as a locus; null when there is nothing to set apart */
  onCreateLocus: (() => void) | null;
  /** residue: its conformers expanded; range: EVERY split residue in it expanded */
  conformersShown: boolean;
  /** letters currently toggled OFF for this selection (only meaningful while shown) */
  mutedLetters: string[];
  /** toggle one conformer letter on/off across the selection's split residues */
  onToggleLetter: (letter: string) => void;
  densityReady: boolean;
  clipMode: ClipMode;
  clipRadius: number;
  onToggleConformers: () => void;
  /** apply (or with "off" clear) the clip sphere over the target */
  onClip: (mode: ClipMode, radius: number) => void;
  onClose: () => void;
  /** add pairwise distances between the conformer copies of the selection's split atoms */
  onConformerSpread: (() => void) | null;
  /** false while the interaction computation is still running */
  bondsReady: boolean;
  /** non-covalent bonds touching the selection */
  bondCount: number;
  /** a persistent bonds overlay exists for THIS selection's ranges */
  showBonds3d: boolean;
  /** toggle the persistent bonds overlay on this selection (it outlives the selection) */
  onShowBonds3d: () => void;
  /** the selection's representation override, null when it follows the global style */
  selRep: RepType | null;
  /** set/clear a persistent representation override on this selection */
  onSelRep: (type: RepType | null) => void;
  /** live distance-measurement count (the footer renders only when > 0) */
  measureCount: number;
  onClearMeasurements: () => void;
  /** reset every structure change (conformers, style, overlays, clip, measurements) */
  onResetAll: () => void;
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
  const subline = target
    ? multi
      ? `${target.residueCount} residues · ${target.splitCount} split`
      : split
        ? `${target.letters.length} conformers`
        : "unsplit"
    : null;
  // a whole-selection clip sphere routinely needs more room than a single residue
  const maxRadius = multi ? 40 : 20;

  return (
    <div
      ref={cardRef}
      data-selection-popup
      className={`fixed z-50 flex flex-col overflow-hidden text-[10.5px] text-ink-secondary ${CARD_SHELL}`}
      style={{ left, top, width: WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* header: identity left, pick/measure modes right */}
      <div className="hs-head justify-between pr-1">
        <span className="hs-value min-w-0 truncate font-medium" title={header ?? undefined}>
          {header ?? <span className="hs-label">no selection</span>}
        </span>
        <div className="flex shrink-0 items-center gap-px">
          <Tooltip content="residue-wise selection">
            <SwitchButton pressed={pickMode === "residue"} onClick={() => onPickMode("residue")}>
              <ResidueModeIcon />
            </SwitchButton>
          </Tooltip>
          <Tooltip content="atom/bond-wise selection (a bond pick takes both atoms)">
            <SwitchButton pressed={pickMode === "atom"} onClick={() => onPickMode("atom")}>
              <AtomModeIcon />
            </SwitchButton>
          </Tooltip>
          <Tooltip content="measure: click two atoms in the 3D view to add a distance between them">
            <SwitchButton pressed={pickMode === "measure"} onClick={() => onPickMode("measure")}>
              <RulerIcon />
            </SwitchButton>
          </Tooltip>
        </div>
      </div>

      {target && (
        <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1">
          <span className="hs-label">{subline}</span>
          <Tooltip
            content={{
              title: "Create a locus",
              is: "Sets this selection apart as a component of its own.",
              rows: [
                { label: "drawn", text: "Sticks in the locus's own colour over the structure, which stays as it is underneath." },
                { label: "where", text: "A row in the loci stack (the bracket icon, top right): hide, select again, remove." },
                { label: "metrics", text: "Its RSCC against the density, computed and painted from that row or the colour board." },
                { label: "kept", text: "For this entry, any number of them." },
              ],
            }}
          >
            <button
              type="button"
              className="hs-btn"
              disabled={!onCreateLocus}
              onClick={() => {
                onCreateLocus?.();
                onClose();
              }}
            >
              + create locus
            </button>
          </Tooltip>
        </div>
      )}

      {split && target && (
        <div className="flex items-center gap-1.5 border-t border-line px-2 py-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {target.letters.map((letter) => {
              const muted = conformersShown && mutedLetters.includes(letter);
              const chip = (
                <>
                  <span
                    className="hs-pip"
                    style={{ background: altColorCss(letter), opacity: conformersShown ? (muted ? 0.25 : 1) : 0.3 }}
                  />
                  <span className={muted ? "line-through opacity-60" : undefined}>{letter}</span>
                </>
              );
              // while the conformers are shown, each chip toggles its letter (and the
              // letter's bonds in the overlay) on/off across the selection
              return conformersShown ? (
                <Tooltip key={letter} content={muted ? `show conformer ${letter} again` : `hide conformer ${letter} (and its bonds)`}>
                  <button
                    type="button"
                    onClick={() => onToggleLetter(letter)}
                    className={`hs-tag bg-white hover:border-accent-line ${muted ? "text-ink-faint" : "border-line-strong"}`}
                  >
                    {chip}
                  </button>
                </Tooltip>
              ) : (
                <span
                  key={letter}
                  className="hs-tag bg-white text-ink-muted"
                >
                  {chip}
                </span>
              );
            })}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-px">
            <Tooltip
              content={
                conformersShown
                  ? `collapse conformers${target.splitCount > 1 ? ` on ${target.splitCount} residues` : ""}`
                  : target.splitCount > 1
                    ? `show conformers on ${target.splitCount} split residues, colored as the chips`
                    : "show conformers, colored as the chips"
              }
            >
              <SwitchButton pressed={conformersShown} onClick={onToggleConformers}>
                <ConformersIcon />
              </SwitchButton>
            </Tooltip>
            <Tooltip content="distances between the conformer copies of every split atom in the selection (capped to avoid clutter)">
              <IconButton disabled={!onConformerSpread} label="conformer distances" onClick={() => onConformerSpread?.()}>
                <SpreadIcon />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      )}

      {target && (
        <div className={`flex flex-col gap-1 border-t border-line px-2 py-1.5 ${densityReady ? "" : "opacity-40"}`}>
          <Heading>clip around selection</Heading>
          <Segmented label="clip around selection">
            {CLIP_MODES.map((m) => (
              <SwitchButton key={m.id} pressed={mode === m.id} disabled={!densityReady} onClick={() => setClip(m.id, radius)}>
                {m.label}
              </SwitchButton>
            ))}
          </Segmented>
          <label className="flex items-center gap-1.5">
            <span className="hs-label">radius</span>
            <input
              type="range"
              className="h-2 min-w-0 flex-1"
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
            <span className="hs-value whitespace-nowrap text-right text-[9.5px]">
              {radius.toFixed(1)}
              <span className="hs-unit"> Å</span>
            </span>
          </label>
        </div>
      )}

      {target && (
        <div className="flex items-center justify-between border-t border-line px-2 py-1">
          <span className="hs-label">
            {!bondsReady ? "computing bonds…" : `${bondCount} bond${bondCount === 1 ? "" : "s"}`}
          </span>
          <Tooltip
            content={{
              title: "Bonds in 3D",
              is: "This selection's non-covalent bonds as dashed contacts.",
              rows: [
                { label: "colour", text: "The conformer that forms the bond; grey for shared atoms." },
                { label: "stays", text: "After the selection clears, until toggled off here on the same residues." },
              ],
            }}
          >
            <SwitchButton pressed={showBonds3d} disabled={!bondsReady || bondCount === 0} onClick={onShowBonds3d}>
              <BondsIcon />
            </SwitchButton>
          </Tooltip>
        </div>
      )}

      {target && (
        <div className="flex items-center justify-between border-t border-line px-2 py-1">
          <span className="hs-label">representation</span>
          <div className="hs-seg">
            <Tooltip
              content={{
                title: "As atoms",
                is: "This selection as spacefill on top of the global style.",
                rows: [{ label: "stays", text: "Until pressed again on the same residues." }],
              }}
            >
              <SwitchButton
                pressed={selRep === "spacefill"}
                onClick={() => onSelRep(selRep === "spacefill" ? null : "spacefill")}
              >
                atoms
              </SwitchButton>
            </Tooltip>
            <Tooltip
              content={{
                title: "As sticks",
                is: "This selection as ball-and-stick on top of the global style.",
                rows: [{ label: "stays", text: "Until pressed again on the same residues." }],
              }}
            >
              <SwitchButton
                pressed={selRep === "ball-and-stick"}
                onClick={() => onSelRep(selRep === "ball-and-stick" ? null : "ball-and-stick")}
              >
                sticks
              </SwitchButton>
            </Tooltip>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line px-2 py-1">
        <span className="hs-label">structure changes</span>
        <Tooltip
          content={{
            title: "Reset the view",
            is: "Back to the freshly loaded look.",
            rows: [
              { label: "undone", text: "Expanded conformers, style changes, bond and representation overlays, the clip, measurements, the selection." },
              { label: "kept", text: "Loci and the map settings." },
            ],
          }}
        >
          <button
            type="button"
            className="hs-btn hs-btn-danger"
            onClick={() => {
              onResetAll();
              onClose();
            }}
          >
            reset all
          </button>
        </Tooltip>
      </div>

      {measureCount > 0 && (
        <div className="flex items-center justify-between border-t border-line px-2 py-1">
          <span className="hs-label">
            {measureCount} distance{measureCount === 1 ? "" : "s"}
          </span>
          <Tooltip content="remove every distance measurement">
            <IconButton label="clear measurements" onClick={onClearMeasurements}>
              <span className="text-[11px] leading-none">{"×"}</span>
            </IconButton>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
