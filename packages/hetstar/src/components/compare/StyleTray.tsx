"use client";
import type { MouseEvent, ReactNode } from "react";

import { HoverFlyout } from "./ui";
import { ColorIcon, ConformersIcon, DensityIcon } from "./icons";

// The viewer's icon tray at the canvas's top-right (positioned by the parent wrapper,
// next to the entry chip): the style board's switch, then two icons with a hover flyout
// each. The density icon's CLICK toggles both maps (its flyout, the map knobs, is built by
// the parent and passed in); the conformers icon hosts the selection / conformer-state
// flyout, also parent-built. What a model is drawn as and coloured by is the style board's.

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
  densityFlyout,
  selectionFlyout,
  selectionFlyoutWidth = 300,
  boardOpen,
  onBoard,
}: {
  /** the main view's model is loaded (the style board enables) */
  ready: boolean;
  /** maps built (the density toggle enables) */
  densityReady: boolean;
  showDensity: boolean;
  onShowDensity: (v: boolean) => void;
  /** flyout content, parent-built (DensityFlyout / SelectionFlyout) */
  densityFlyout: ReactNode;
  selectionFlyout: ReactNode;
  /** card width of the selection flyout; the world panel asks for more room */
  selectionFlyoutWidth?: number;
  /** the style board is open */
  boardOpen: boolean;
  /** open or close the style board */
  onBoard: () => void;
}) {
  return (
    <div className="flex items-center gap-px">
      <TrayButton
        active={boardOpen}
        disabled={!ready}
        label="style board"
        title="style: what each model is drawn as and coloured by, and what the map is painted with"
        onClick={() => onBoard()}
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
    </div>
  );
}
