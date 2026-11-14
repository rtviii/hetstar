"use client";
import type { MouseEvent, ReactNode } from "react";

import type { RepQuality, RepStyle, RepType } from "../../lib/molstar/repstyle";
import { TARGET_MODEL } from "../color/board";
import { GroupLabel, HoverFlyout, Segmented, SliderRow, SwitchButton, TinyText } from "./ui";
import { ColorIcon, ConformersIcon, DensityIcon, StyleIcon } from "./icons";

// The viewer's icon tray at the canvas's top-right (positioned by the parent wrapper,
// next to the entry chip): the colour board's switch, then three icons with a hover flyout
// each. The density icon's CLICK toggles both maps (its flyout, the map knobs, is built by
// the parent and passed in); the conformers icon hosts the selection / conformer-state
// flyout, also parent-built; the style icon's flyout lives here (representation type +
// scale, the model-B ghost, mesh quality). Colour is the colour board's.
// Everything updates representations in place — never the MolstarViewer `view` prop,
// which would clear the state tree.

const REP_TYPES: { id: RepType; label: string }[] = [
  { id: "cartoon", label: "cartoon" },
  { id: "ball-and-stick", label: "sticks" },
  { id: "spacefill", label: "atoms" },
];

// one "scale" slider per representation type
const SCALE_RANGE: Record<RepType, { min: number; max: number; step: number }> = {
  "ball-and-stick": { min: 0.05, max: 0.5, step: 0.01 },
  spacefill: { min: 0.1, max: 2, step: 0.05 },
  cartoon: { min: 0.05, max: 1, step: 0.05 },
};

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
      aria-pressed={active}
      className="hs-btn h-6 w-6 p-0"
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
  selectionFlyoutWidth = 300,
  colorOpen,
  onColor,
  colorLabel,
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
  /** card width of the selection flyout; the world panel asks for more room */
  selectionFlyoutWidth?: number;
  /** the colour board is open */
  colorOpen: boolean;
  /** open or close the colour board; a target id opens it on that target's column */
  onColor: (targetId?: string) => void;
  /** what the main view's model is coloured by, by name */
  colorLabel: string;
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
        <Segmented label="representation">
          {REP_TYPES.map((t) => (
            <SwitchButton key={t.id} pressed={style.type === t.id} onClick={() => patch({ type: t.id })}>
              {t.label}
            </SwitchButton>
          ))}
        </Segmented>
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
          <input type="checkbox" checked={showB && bAvailable} disabled={!bAvailable} onChange={(e) => onShowB(e.target.checked)} />
          <span>model B: deposited (ghost)</span>
        </label>
      </div>

      <div className="flex items-center gap-2 border-t border-line pt-1.5">
        <GroupLabel>color</GroupLabel>
        <button
          type="button"
          className="hs-btn min-w-0 justify-start normal-case tracking-normal"
          title="what the model is coloured by; opens the colour board on it"
          onClick={() => onColor(TARGET_MODEL)}
        >
          <span className="truncate">{colorLabel}</span>
        </button>
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-1.5">
        <GroupLabel>model quality</GroupLabel>
        <Segmented label="model quality">
          {REP_QUALITIES.map((q) => (
            <SwitchButton key={q} pressed={style.quality === q} onClick={() => patch({ quality: q })}>
              {q}
            </SwitchButton>
          ))}
        </Segmented>
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-px">
      <TrayButton
        active={colorOpen}
        label="colour board"
        title="colour: what the model, the map, the sequence and each replica are coloured by"
        onClick={() => onColor()}
      >
        <ColorIcon />
      </TrayButton>
      <HoverFlyout content={densityFlyout} width={264} align="end">
        <TrayButton
          active={showDensity}
          disabled={!densityReady}
          label="density: maps compute in the background; click toggles them, hover for metric painting and map controls"
          onClick={() => onShowDensity(!showDensity)}
        >
          <DensityIcon />
        </TrayButton>
      </HoverFlyout>
      <HoverFlyout content={selectionFlyout} width={selectionFlyoutWidth} align="end" pinOnClick>
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
