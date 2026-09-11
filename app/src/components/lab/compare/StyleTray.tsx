"use client";
import type { ReactNode } from "react";

import type { RepColorMode, RepQuality, RepStyle, RepType } from "@/lib/molstar/repstyle";
import { HoverFlyout, SliderRow, SwitchButton, TinyText } from "./ui";

// The viewer's icon tray at the canvas's top-right (positioned by the parent wrapper,
// next to the entry chip): three icons, each with a hover flyout. The density icon's
// CLICK toggles both maps (its flyout — metric painting, map knobs, quality, slice —
// is built by the parent and passed in); the conformers icon hosts the selection /
// conformer-state flyout, also parent-built; the style icon's flyout lives here
// (representation type + sliders, color mode, mesh quality, the model-B ghost).
// Everything updates representations in place — never the MolstarViewer `view` prop,
// which would clear the state tree.

const REP_TYPES: { id: RepType; label: string }[] = [
  { id: "ball-and-stick", label: "sticks" },
  { id: "spacefill", label: "spheres" },
  { id: "cartoon", label: "cartoon" },
];

const COLOR_MODES: { id: RepColorMode; label: string }[] = [
  { id: "model", label: "model" },
  { id: "element", label: "element" },
  { id: "chain", label: "chain" },
];

const REP_QUALITIES: RepQuality[] = ["auto", "high", "medium", "low"];

function DensityIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.6" />
      <circle cx="8" cy="8" r="6" opacity="0.5" />
    </svg>
  );
}

// two offset stick traces sharing endpoints: a residue split into alternate conformers
function ConformersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 12 L6 8 L10 10 L14 5" />
      <path d="M2 12 L6 12.5 L10 14 L14 5" opacity="0.45" />
      <circle cx="2" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14" cy="5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function StyleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
      <circle cx="6" cy="4" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="11" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TrayButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  /** aria-label only — no native title: the hover flyout is the explanation */
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
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

  const styleCard = (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <span className="text-[10.5px] uppercase tracking-wide text-ink-muted/75">representation</span>
        <div className="flex items-center gap-1">
          {REP_TYPES.map((t) => (
            <SwitchButton key={t.id} pressed={style.type === t.id} onClick={() => patch({ type: t.id })}>
              {t.label}
            </SwitchButton>
          ))}
        </div>
        {style.type === "ball-and-stick" && (
          <>
            <SliderRow
              label={`stick thickness: ${style.ballStick.sizeFactor.toFixed(2)}`}
              min={0.05}
              max={0.5}
              step={0.01}
              value={style.ballStick.sizeFactor}
              onChange={(v) => patch({ ballStick: { ...style.ballStick, sizeFactor: v } })}
            />
            <SliderRow
              label={`stick vs ball: ${style.ballStick.sizeAspectRatio.toFixed(2)}`}
              min={0.2}
              max={1.5}
              step={0.05}
              value={style.ballStick.sizeAspectRatio}
              onChange={(v) => patch({ ballStick: { ...style.ballStick, sizeAspectRatio: v } })}
            />
          </>
        )}
        {style.type === "spacefill" && (
          <SliderRow
            label={`atom radius scale: ${style.spacefill.sizeFactor.toFixed(2)}`}
            min={0.3}
            max={2}
            step={0.05}
            value={style.spacefill.sizeFactor}
            onChange={(v) => patch({ spacefill: { sizeFactor: v } })}
          />
        )}
        {style.type === "cartoon" && (
          <>
            <SliderRow
              label={`trace thickness: ${style.cartoon.sizeFactor.toFixed(2)}`}
              min={0.05}
              max={1}
              step={0.05}
              value={style.cartoon.sizeFactor}
              onChange={(v) => patch({ cartoon: { ...style.cartoon, sizeFactor: v } })}
            />
            <SliderRow
              label={`ribbon aspect: ${style.cartoon.aspectRatio.toFixed(1)}`}
              min={1}
              max={8}
              step={0.5}
              value={style.cartoon.aspectRatio}
              onChange={(v) => patch({ cartoon: { ...style.cartoon, aspectRatio: v } })}
            />
            <TinyText>cartoon draws the polymer trace only: side chains, and with them the expanded conformers, are not visible; ligands and ions stay as sticks</TinyText>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-1.5">
        <span className="text-[10.5px] uppercase tracking-wide text-ink-muted/75">layers</span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showB} disabled={!bAvailable} onChange={(e) => onShowB(e.target.checked)} />
          <span>model B: deposited (ghost)</span>
        </label>
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-1.5">
        <span className="text-[10.5px] uppercase tracking-wide text-ink-muted/75">color</span>
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
        <span className="text-[10.5px] uppercase tracking-wide text-ink-muted/75">model quality</span>
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
          label="density: click toggles the maps; hover for metric painting and map controls"
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
