"use client";
import type { MouseEvent, ReactNode } from "react";

import type { RepColorMode, RepQuality, RepStyle, RepType } from "@/lib/molstar/repstyle";
import { GroupLabel, HoverFlyout, SliderRow, SwitchButton, TinyText } from "./ui";
import { ConformersIcon, DensityIcon, StyleIcon } from "./icons";

// The viewer's icon tray at the canvas's top-right (positioned by the parent wrapper,
// next to the entry chip): three icons, each with a hover flyout. The density icon's
// CLICK toggles both maps (its flyout — metric painting, map knobs, quality, slice —
// is built by the parent and passed in); the conformers icon hosts the selection /
// conformer-state flyout, also parent-built; the style icon's flyout lives here
// (representation type + sliders, color mode, mesh quality, the model-B ghost).
// Everything updates representations in place — never the MolstarViewer `view` prop,
// which would clear the state tree.

const REP_TYPES: { id: RepType; label: string }[] = [
  { id: "cartoon", label: "cartoon" },
  { id: "ball-and-stick", label: "sticks&balls" },
  { id: "spacefill", label: "atoms" },
];

// one "scale" slider per representation type
const SCALE_RANGE: Record<RepType, { min: number; max: number; step: number }> = {
  "ball-and-stick": { min: 0.05, max: 0.5, step: 0.01 },
  spacefill: { min: 0.1, max: 2, step: 0.05 },
  cartoon: { min: 0.05, max: 1, step: 0.05 },
};

const COLOR_MODES: { id: RepColorMode; label: string }[] = [
  { id: "model", label: "model" },
  { id: "element", label: "element" },
  { id: "chain", label: "chain" },
];

const REP_QUALITIES: RepQuality[] = ["auto", "high", "medium", "low"];

export function TrayButton({
  active,
  disabled,
  label,
  title,
  onClick,
  onContextMenu,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  /** aria-label only — no native title: the hover flyout is the explanation */
  label: string;
  /** native tooltip, for buttons WITHOUT a hover flyout (the bookmark stack) */
  title?: string;
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex h-6 w-6 items-center justify-center rounded border transition-colors disabled:cursor-default disabled:opacity-40 ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-line-strong bg-white/85 text-ink-secondary hover:bg-line"
      }`}
    >
      {children}
    </button>
  );
}

export default function StyleTray({
  ready,
  densityReady,
  showDensity,
  onShowDensity,
  style,
  onStyle,
  showB,
  bAvailable,
  onShowB,
  densityFlyout,
  selectionFlyout,
}: {
  /** primary structure loaded (representation controls enable) */
  ready: boolean;
  /** maps built (the density toggle enables) */
  densityReady: boolean;
  showDensity: boolean;
  onShowDensity: (v: boolean) => void;
  style: RepStyle;
  onStyle: (s: RepStyle) => void;
  showB: boolean;
  bAvailable: boolean;
  onShowB: (v: boolean) => void;
  /** flyout content, parent-built (DensityFlyout / SelectionFlyout) */
  densityFlyout: ReactNode;
  selectionFlyout: ReactNode;
}) {
  const patch = (p: Partial<RepStyle>) => onStyle({ ...style, ...p });
  const scale = SCALE_RANGE[style.type];
  const scaleValue =
    style.type === "ball-and-stick"
      ? style.ballStick.sizeFactor
      : style.type === "spacefill"
        ? style.spacefill.sizeFactor
        : style.cartoon.sizeFactor;
  const setScale = (v: number) =>
    patch(
      style.type === "ball-and-stick"
        ? { ballStick: { sizeFactor: v } }
        : style.type === "spacefill"
          ? { spacefill: { sizeFactor: v } }
          : { cartoon: { sizeFactor: v } },
    );

  const styleCard = (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <GroupLabel>representation</GroupLabel>
        <div className="flex items-center gap-1">
          {REP_TYPES.map((t) => (
            <SwitchButton key={t.id} pressed={style.type === t.id} onClick={() => patch({ type: t.id })}>
              {t.label}
            </SwitchButton>
          ))}
        </div>
        <SliderRow
          label="scale"
          min={scale.min}
          max={scale.max}
          step={scale.step}
          value={scaleValue}
          display={scaleValue.toFixed(2)}
          onChange={setScale}
        />
        {style.type === "cartoon" && (
          <TinyText>cartoon draws the polymer trace only: side chains, and with them the expanded conformers, are not visible; ligands and ions stay as sticks</TinyText>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-1.5">
        <GroupLabel>layers</GroupLabel>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showB} disabled={!bAvailable} onChange={(e) => onShowB(e.target.checked)} />
          <span>model B: deposited (ghost)</span>
        </label>
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-1.5">
        <GroupLabel>color</GroupLabel>
        <div className="flex items-center gap-1">
          {COLOR_MODES.map((m) => (
            <SwitchButton key={m.id} pressed={style.colorMode === m.id} onClick={() => patch({ colorMode: m.id })}>
              {m.label}
            </SwitchButton>
          ))}
        </div>
        {style.colorMode === "element" && (
          <TinyText>heteroatoms in CPK; carbons keep each model&apos;s identity color</TinyText>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-1.5">
        <GroupLabel>model quality</GroupLabel>
        <div className="flex items-center gap-1">
          {REP_QUALITIES.map((q) => (
            <SwitchButton key={q} pressed={style.quality === q} onClick={() => patch({ quality: q })}>
              {q}
            </SwitchButton>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-1">
      <HoverFlyout content={densityFlyout} width={300} align="end">
        <TrayButton
          active={showDensity}
          disabled={!densityReady}
          label="density: maps compute in the background; click toggles them, hover for metric painting and map controls"
          onClick={() => onShowDensity(!showDensity)}
        >
          <DensityIcon />
        </TrayButton>
      </HoverFlyout>
      <HoverFlyout content={selectionFlyout} width={300} align="end" pinOnClick>
        <TrayButton active={false} label="selection and conformer states">
          <ConformersIcon />
        </TrayButton>
      </HoverFlyout>
      <HoverFlyout content={styleCard} width={240} align="end" pinOnClick>
        <TrayButton active={false} disabled={!ready} label="style: representation, colors, quality">
          <StyleIcon />
        </TrayButton>
      </HoverFlyout>
    </div>
  );
}
