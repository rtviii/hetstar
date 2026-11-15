"use client";
import type { DensityQuality } from "../../lib/molstar/density";
import { GroupLabel, HintMark, SwitchButton, TinyText } from "./ui";

// The maps themselves: which are drawn, the 2Fo-Fc contour, their opacity and the grid they
// are carved at. One row per knob. What the 2Fo-Fc surface is painted with belongs to the
// style board; the last row names it and opens the board on the map. Rendered inside the
// tray's flyout on the density icon (whose CLICK toggles the maps); state lives in
// HetstarViewer.

const DENSITY_QUALITIES: DensityQuality[] = ["low", "auto", "high"];

const ROW = "grid grid-cols-[52px_minmax(0,1fr)_44px] items-center gap-x-2";

export default function DensityFlyout({
  densityReady,
  densityBusy,
  show2fofc,
  onShow2fofc,
  sigma,
  onSigma,
  showFofc,
  onShowFofc,
  opacity,
  onOpacity,
  densityQuality,
  onDensityQuality,
  paintLabel,
  onOpenColor,
}: {
  densityReady: boolean;
  densityBusy: boolean;
  show2fofc: boolean;
  onShow2fofc: (v: boolean) => void;
  sigma: number;
  onSigma: (v: number) => void;
  showFofc: boolean;
  onShowFofc: (v: boolean) => void;
  /** factor on the maps' base alphas (both maps), 0.15 to 1 */
  opacity: number;
  onOpacity: (v: number) => void;
  densityQuality: DensityQuality;
  onDensityQuality: (q: DensityQuality) => void;
  /** what the 2Fo-Fc surface is painted with, by name */
  paintLabel: string;
  /** open the style board on the map */
  onOpenColor: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <GroupLabel>Maps{densityBusy ? ", rebuilding" : ""}</GroupLabel>
      <div className={ROW}>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={show2fofc} disabled={!densityReady} onChange={(e) => onShow2fofc(e.target.checked)} />
          <span className="hs-value">2Fo-Fc</span>
        </label>
        <input
          type="range"
          aria-label="2Fo-Fc contour level"
          className="min-w-0"
          min={0.5}
          max={4}
          step={0.1}
          value={sigma}
          disabled={!densityReady || !show2fofc}
          onChange={(e) => onSigma(Number(e.target.value))}
        />
        <span className="hs-value text-right text-[10px]">
          {sigma.toFixed(1)}
          <span className="hs-unit"> sigma</span>
        </span>
      </div>
      <div className={ROW}>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showFofc} disabled={!densityReady} onChange={(e) => onShowFofc(e.target.checked)} />
          <span className="hs-value">Fo-Fc</span>
        </label>
        <span className="text-[10px] text-ink-muted">
          +3 green, -3 red
          <HintMark
            tip={{
              title: "Fo-Fc difference map",
              is: "Where the data and the model disagree.",
              rows: [
                { label: "green", text: "+3 sigma: density the model does not explain." },
                { label: "red", text: "-3 sigma: modeled matter the data lack." },
                { label: "levels", text: "Fixed at 3 sigma." },
                { label: "from", text: "The same client-side FFT as the 2Fo-Fc map." },
              ],
            }}
          />
        </span>
        <span />
      </div>
      <div className={ROW}>
        <span className="hs-label">opacity</span>
        <input
          type="range"
          aria-label="map opacity"
          className="min-w-0"
          min={0.15}
          max={1}
          step={0.05}
          value={opacity}
          disabled={!densityReady}
          onChange={(e) => onOpacity(Number(e.target.value))}
        />
        <span className="hs-value text-right text-[10px]">
          {Math.round(opacity * 100)}
          <span className="hs-unit"> %</span>
        </span>
      </div>
      <div className={ROW}>
        <span className="hs-label">
          grid
          <HintMark
            tip={{
              title: "Map grid",
              is: "How finely the maps are carved around the model.",
              rows: [
                { label: "auto", text: "The default point budget." },
                { label: "high", text: "A finer grid and float-textured surfaces; rebuilding takes a few seconds." },
                { label: "low", text: "A coarser grid, for large entries." },
              ],
            }}
          />
        </span>
        <div className="hs-seg">
          {DENSITY_QUALITIES.map((q) => (
            <SwitchButton key={q} pressed={densityQuality === q} disabled={!densityReady || densityBusy} onClick={() => onDensityQuality(q)}>
              {q}
            </SwitchButton>
          ))}
        </div>
        <span />
      </div>
      <div className={ROW}>
        <span className="hs-label">color</span>
        <button
          type="button"
          className="hs-btn min-w-0 justify-start normal-case tracking-normal"
          title="what the 2Fo-Fc surface is painted with; opens the style board on the map"
          onClick={onOpenColor}
        >
          <span className="truncate">{paintLabel}</span>
        </button>
        <span />
      </div>
      {!densityReady && <TinyText>maps compute in the background; the density button turns them on once they are in</TinyText>}
    </div>
  );
}
