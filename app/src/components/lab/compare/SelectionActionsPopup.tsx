"use client";
import { useEffect, useRef, useState } from "react";
import type { PickInfo } from "@/lib/molstar/viewer";
import { altColorCss } from "@/lib/molstar/altloc-theme";

// The Selection Actions Panel: opened by a (non-drag) right click, fixed at the cursor
// and clamped to the viewport. Acts on ONE residue — or, when the right click lands
// inside the current range selection, on the WHOLE range: conformer expansion, the clip
// sphere and the metric scope all generalize to every residue of the target. The
// conformer chips carry the SAME letter colors the 3D overpaint uses (altloc-theme's
// AltColors), so the panel doubles as the legend once conformers are shown.

const WIDTH = 252;

export type ClipMode = "off" | "density" | "all";

export type ActionTarget =
  | { kind: "residue"; pick: PickInfo; altIds: string[] }
  | {
      kind: "range";
      chain: string;
      from: number;
      to: number;
      /** non-water residues inside the range */
      residueCount: number;
      /** how many of them are split into conformers */
      splitCount: number;
      /** union of altloc letters across the range */
      letters: string[];
    };

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
      className="w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-left text-[11.5px] text-neutral-700 hover:border-neutral-400 hover:bg-neutral-100 disabled:cursor-default disabled:opacity-40 disabled:hover:border-neutral-300 disabled:hover:bg-neutral-50"
    >
      {children}
    </button>
  );
}

export default function SelectionActionsPopup({
  anchor,
  target,
  conformersShown,
  densityReady,
  clipMode,
  clipRadius,
  onToggleConformers,
  onClip,
  onSetScope,
  onClose,
}: {
  anchor: { x: number; y: number };
  target: ActionTarget;
  /** residue: its conformers expanded; range: EVERY split residue in it expanded */
  conformersShown: boolean;
  densityReady: boolean;
  clipMode: ClipMode;
  clipRadius: number;
  onToggleConformers: () => void;
  /** apply (or with "off" clear) the clip sphere over the target */
  onClip: (mode: ClipMode, radius: number) => void;
  onSetScope: () => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [radius, setRadius] = useState(clipRadius);
  const [mode, setMode] = useState<ClipMode>(clipMode);

  // Escape and outside-mousedown close the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 250));

  const setClip = (m: ClipMode, r: number) => {
    setMode(m);
    setRadius(r);
    onClip(m, r);
  };

  const isRange = target.kind === "range";
  const letters = isRange ? target.letters : target.altIds;
  const split = isRange ? target.splitCount > 0 : target.altIds.length > 1;
  // a whole-range clip sphere routinely needs more room than a single residue
  const maxRadius = isRange ? 40 : 20;

  return (
    <div
      ref={cardRef}
      className="fixed z-50 flex flex-col gap-1.5 rounded border border-neutral-200 bg-white p-2 text-[11.5px] text-neutral-700 shadow-lg"
      style={{ left, top, width: WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-baseline justify-between px-0.5">
        <span className="font-medium">
          {isRange
            ? `${target.chain} ${target.from}–${target.to}`
            : `${target.pick.compId} ${target.pick.chainId}/${target.pick.authSeqId}`}
        </span>
        <span className="text-[10.5px] text-neutral-400">
          {isRange
            ? `${target.splitCount} of ${target.residueCount} split`
            : split
              ? `${target.altIds.length} conformers`
              : "unsplit"}
        </span>
      </div>

      {split && (
        <div className="flex flex-col gap-1 border-t border-neutral-100 pt-1.5">
          <div className="flex items-center gap-1.5 px-0.5">
            {letters.map((letter) => (
              <span
                key={letter}
                className={`flex items-center gap-1 rounded border px-1 py-0.5 text-[10.5px] ${
                  conformersShown ? "border-neutral-300 text-neutral-700" : "border-neutral-200 text-neutral-400"
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
            {isRange
              ? conformersShown
                ? `collapse conformers on ${target.splitCount} residues`
                : `show conformers on ${target.splitCount} split residues`
              : conformersShown
                ? "collapse conformers"
                : "show conformers, colored as above"}
          </ActionButton>
        </div>
      )}

      <div className={`flex flex-col gap-1 border-t border-neutral-100 pt-1.5 ${densityReady ? "" : "opacity-40"}`}>
        <div className="px-0.5 text-[10.5px] uppercase tracking-wide text-neutral-400">
          {isRange ? "clip around selection" : "clip around residue"}
        </div>
        <div className="flex items-center gap-1">
          {CLIP_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={!densityReady}
              onClick={() => setClip(m.id, radius)}
              className={`rounded border px-1.5 py-0.5 text-[10.5px] leading-tight disabled:cursor-default ${
                mode === m.id
                  ? "border-sky-700 bg-sky-50 text-sky-900"
                  : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 px-0.5">
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
          <span className="w-12 text-right tabular-nums text-neutral-500">{radius.toFixed(1)} A</span>
        </label>
      </div>

      <div className="border-t border-neutral-100 pt-1.5">
        <ActionButton onClick={onSetScope}>set as metric scope</ActionButton>
      </div>
    </div>
  );
}
