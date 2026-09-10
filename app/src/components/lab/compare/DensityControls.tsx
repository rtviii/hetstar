"use client";
import { SectionLabel, SliderRow, TinyText, Tooltip } from "./ui";

// Density layer controls: map visibility toggles + the 2Fo-Fc contour. Loading is the
// loader's business; these enable once density is ready.

export default function DensityControls({
  ready,
  show2fofc,
  onShow2fofc,
  sigma,
  onSigma,
  showFofc,
  onShowFofc,
  opacity,
  onOpacity,
  showB,
  bAvailable,
  onShowB,
}: {
  ready: boolean;
  show2fofc: boolean;
  onShow2fofc: (v: boolean) => void;
  sigma: number;
  onSigma: (v: number) => void;
  showFofc: boolean;
  onShowFofc: (v: boolean) => void;
  /** factor on the maps' base alphas (both maps), 0.15 to 1 */
  opacity: number;
  onOpacity: (v: number) => void;
  showB: boolean;
  bAvailable: boolean;
  onShowB: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Layers</SectionLabel>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={showB} disabled={!bAvailable} onChange={(e) => onShowB(e.target.checked)} />
        <span>model B: deposited (ghost)</span>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={show2fofc} disabled={!ready} onChange={(e) => onShow2fofc(e.target.checked)} />
        <span>2Fo-Fc</span>
      </label>
      <SliderRow
        label={`2Fo-Fc contour: ${sigma.toFixed(1)} sigma`}
        min={0.5}
        max={4}
        step={0.1}
        value={sigma}
        disabled={!ready || !show2fofc}
        onChange={onSigma}
      />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={showFofc} disabled={!ready} onChange={(e) => onShowFofc(e.target.checked)} />
        <Tooltip
          content={
            <div className="flex flex-col gap-1">
              <div className="font-medium">Fo-Fc difference map</div>
              <div>
                Isosurfaces at +3 sigma (green: density the model does not explain) and -3 sigma (red: modeled
                matter the data lack). Levels fixed; from the same client-side FFT as 2Fo-Fc.
              </div>
            </div>
          }
        >
          <span>Fo-Fc (+3 green / -3 red)</span>
        </Tooltip>
      </label>
      <SliderRow
        label={`map opacity: ${Math.round(opacity * 100)}%`}
        min={0.15}
        max={1}
        step={0.05}
        value={opacity}
        disabled={!ready}
        onChange={onOpacity}
      />
      {!ready && <TinyText>density loads with the entry; toggles enable when the maps are in</TinyText>}
    </div>
  );
}
