"use client";
import { SLICE_AXES, type SliceAxis } from "../SlicePanel";
import { SectionLabel } from "./ui";

// The slice plane's controls: whether it cuts the density in 3D and the models, its
// normal and its position through the model box. Always visible in the bottom tools
// panel; the 2D map that images the same plane is optional (style flyout) and sits
// underneath when on.

export default function SliceControls({
  ready,
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
  /** maps built: the plane has something to cut */
  ready: boolean;
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
    <div className="flex flex-col gap-1 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <SectionLabel>Slice</SectionLabel>
        <label className="flex items-center gap-1 text-ink-secondary">
          <input type="checkbox" checked={slice3d} disabled={!ready} onChange={(e) => onSlice3d(e.target.checked)} />
          <span>plane in 3D</span>
        </label>
        <label className="flex items-center gap-1 text-ink-secondary">
          <input type="checkbox" checked={sliceModel} disabled={!ready} onChange={(e) => onSliceModel(e.target.checked)} />
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
                disabled={!ready}
                onChange={() => onAxis(i as SliceAxis)}
              />
              <span>{a}</span>
            </label>
          ))}
        </span>
      </div>
      <label className="flex items-center gap-2">
        <span className="w-20 whitespace-nowrap tabular-nums text-ink-muted">
          {SLICE_AXES[axis]} = {coord == null ? "-" : `${coord.toFixed(1)} A`}
        </span>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0}
          max={1}
          step={0.005}
          value={frac}
          disabled={!ready}
          onChange={(e) => onFrac(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
