"use client";
import { useCallback, useRef, useState } from "react";

import type { DensityQuality } from "@/lib/molstar/density";
import type { RepColorMode, RepQuality, RepStyle, RepType } from "@/lib/molstar/repstyle";
import { SliderRow, SwitchButton, TinyText, useDismiss } from "./ui";

// The viewer's style tray at the canvas's top-right (positioned by the parent wrapper,
// next to the entry chip): a density on/off chip and a style flyout (representation type
// + its size sliders, color mode, mesh quality, the density quality knob, and the 2D
// slice map switch). Everything here updates representations in place — never the
// MolstarViewer `view` prop, which would clear the state tree.

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
const DENSITY_QUALITIES: DensityQuality[] = ["low", "auto", "high"];

function DensityIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.6" />
      <circle cx="8" cy="8" r="6" opacity="0.5" />
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
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
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
  densityBusy,
  showDensity,
  onShowDensity,
  style,
  onStyle,
  densityQuality,
  onDensityQuality,
  showSlice2d,
  onShowSlice2d,
}: {
  /** primary structure loaded (representation controls enable) */
  ready: boolean;
  /** maps built (density controls enable) */
  densityReady: boolean;
  /** a density-quality rebuild is in flight */
  densityBusy: boolean;
  showDensity: boolean;
  onShowDensity: (v: boolean) => void;
  style: RepStyle;
  onStyle: (s: RepStyle) => void;
  densityQuality: DensityQuality;
  onDensityQuality: (q: DensityQuality) => void;
  /** the optional 2D slice map in the bottom tools panel */
  showSlice2d: boolean;
  onShowSlice2d: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const patch = (p: Partial<RepStyle>) => onStyle({ ...style, ...p });

  return (
    <div ref={rootRef} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <TrayButton
          active={showDensity}
          disabled={!densityReady}
          title={showDensity ? "density on (click to hide)" : "density off (click to show)"}
          onClick={() => onShowDensity(!showDensity)}
        >
          <DensityIcon />
        </TrayButton>
        <TrayButton active={open} disabled={!ready} title="style: representation, colors, quality" onClick={() => setOpen((v) => !v)}>
          <StyleIcon />
        </TrayButton>
      </div>

      {open && (
        <div className="flex w-60 flex-col gap-2.5 rounded border border-line bg-white p-2.5 text-[11px] text-ink-secondary shadow-md">
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

          <div className={`flex flex-col gap-1 border-t border-line pt-1.5 ${densityReady ? "" : "opacity-40"}`}>
            <span className="text-[10.5px] uppercase tracking-wide text-ink-muted/75">
              density quality{densityBusy ? " — rebuilding..." : ""}
            </span>
            <div className="flex items-center gap-1">
              {DENSITY_QUALITIES.map((q) => (
                <SwitchButton
                  key={q}
                  pressed={densityQuality === q}
                  disabled={!densityReady || densityBusy}
                  onClick={() => onDensityQuality(q)}
                >
                  {q}
                </SwitchButton>
              ))}
            </div>
            <TinyText>high re-carves the maps at a finer grid and renders float-textured surfaces (a few seconds)</TinyText>
          </div>

          <div className="flex flex-col gap-1 border-t border-line pt-1.5">
            <span className="text-[10.5px] uppercase tracking-wide text-ink-muted/75">2D slice map</span>
            <div className="flex items-center gap-1">
              <SwitchButton pressed={!showSlice2d} onClick={() => onShowSlice2d(false)}>
                off
              </SwitchButton>
              <SwitchButton pressed={showSlice2d} onClick={() => onShowSlice2d(true)}>
                on
              </SwitchButton>
            </div>
            <TinyText>
              images the slice plane in the bottom panel; the plane itself (normal, position, what it cuts) is set there
            </TinyText>
          </div>
        </div>
      )}
    </div>
  );
}
