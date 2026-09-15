"use client";
import { SLICE_AXES, type SliceAxis } from "../SlicePanel";

// The slice plane's controls: whether it cuts the density in 3D and the models, its
// normal and its position through the model box. Rendered inside the density flyout's
// "2D slice map" section; the 2D image of the same plane floats over the canvas when
// switched on there. The plane itself needs only the model box (slice-model clipping
// works before any density); only the in-scene density plane needs the maps.

export default function SliceControls({
  boxReady,
  densityReady,
  slice3d,
  onSlice3d,
  sliceModel,
  onSliceModel,
  axis,
  onAxis,
  frac,
  onFrac,
  coord,
}: {
  /** the model box exists: the plane, its normal and slice-model clipping work */
  boxReady: boolean;
  /** maps built: the in-scene density plane has something to image */
  densityReady: boolean;
  slice3d: boolean;
  onSlice3d: (v: boolean) => void;
  sliceModel: boolean;
  onSliceModel: (v: boolean) => void;
  axis: SliceAxis;
  onAxis: (a: SliceAxis) => void;
  /** 0..1 through the box along the normal */
  frac: number;
  onFrac: (v: number) => void;
  /** the plane's coordinate along its normal, in A; null before a box exists */
  coord: number | null;
}) {
  return (
    <div className="flex flex-col gap-1 text-[10.5px]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <label className="flex items-center gap-1 text-ink-secondary">
          <input type="checkbox" checked={slice3d} disabled={!densityReady} onChange={(e) => onSlice3d(e.target.checked)} />
          <span>plane in 3D</span>
        </label>
        <label className="flex items-center gap-1 text-ink-secondary">
          <input type="checkbox" checked={sliceModel} disabled={!boxReady} onChange={(e) => onSliceModel(e.target.checked)} />
          <span>slice model</span>
        </label>
        <span className="flex items-center gap-1.5">
          <span className="text-ink-muted">normal</span>
          {SLICE_AXES.map((a, i) => (
            <label key={a} className="flex items-center gap-1 text-ink-secondary">
              <input
                type="radio"
                name="slice-normal"
                checked={axis === i}
                disabled={!boxReady}
                onChange={() => onAxis(i as SliceAxis)}
              />
              <span>{a}</span>
            </label>
          ))}
        </span>
      </div>
      <label className="flex items-center gap-2">
        <span className="whitespace-nowrap tabular-nums text-[10px] text-ink-muted">
          {SLICE_AXES[axis]} = {coord == null ? "-" : `${coord.toFixed(1)} A`}
        </span>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0}
          max={1}
          step={0.005}
          value={frac}
          disabled={!boxReady}
          onChange={(e) => onFrac(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
