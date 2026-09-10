"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { rampColor } from "@/lib/lab/color";

// The dedicated slice VIEWER: a 2D canvas sampling density and metric on the same plane
// lattice, instead of the unusable in-scene slice plane. Density renders as grayscale
// (white low, dark high, in sigma units), the metric as its color ramp, overlay draws
// metric color over density luminance. Axis-aligned normals + a position slider for now;
// arbitrary normals when there is a UI story for orienting them.

type Sampler = (x: number, y: number, z: number) => number;

export interface SlicePlane {
  point: [number, number, number];
  normal: [number, number, number];
}

const AXES = ["x", "y", "z"] as const;
const MAX_SAMPLES_U = 320;
const MAX_SAMPLES_V = 240;
const DENSITY_SIGMA_RANGE: [number, number] = [-1, 4];

function densityShade(sigma: number): number {
  if (Number.isNaN(sigma)) return 250;
  const [lo, hi] = DENSITY_SIGMA_RANGE;
  const t = Math.min(1, Math.max(0, (sigma - lo) / (hi - lo)));
  return Math.round(255 - t * 215);
}

export default function SlicePanel({
  box,
  densitySampler,
  metricSampler,
  metricDomain,
  metricColors,
  metricLabel,
  onPlaneChange,
}: {
  box: { min: [number, number, number]; max: [number, number, number] } | null;
  /** 2Fo-Fc in sigma units (wrapped, pristine grid) */
  densitySampler: Sampler | null;
  /** projected metric, absolute units; null while nothing is projected */
  metricSampler: Sampler | null;
  metricDomain: [number, number] | null;
  metricColors: number[] | null;
  metricLabel: string | null;
  onPlaneChange?: (plane: SlicePlane) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [axis, setAxis] = useState<0 | 1 | 2>(2);
  const [frac, setFrac] = useState(0.5);
  const [mode, setMode] = useState<"overlay" | "metric" | "density">("overlay");
  const [readout, setReadout] = useState<string | null>(null);

  const hasMetric = !!(metricSampler && metricDomain);

  // Plane geometry: normal along `axis`; the canvas spans the two remaining axes.
  const geom = useMemo(() => {
    if (!box) return null;
    const u = ((axis + 1) % 3) as 0 | 1 | 2;
    const v = ((axis + 2) % 3) as 0 | 1 | 2;
    const uLen = box.max[u] - box.min[u];
    const vLen = box.max[v] - box.min[v];
    if (uLen <= 0 || vLen <= 0) return null;
    const W = MAX_SAMPLES_U;
    const H = Math.min(MAX_SAMPLES_V, Math.max(40, Math.round((W * vLen) / uLen)));
    const planeCoord = box.min[axis] + frac * (box.max[axis] - box.min[axis]);
    return { u, v, uLen, vLen, W, H, planeCoord };
  }, [box, axis, frac]);

  useEffect(() => {
    if (!geom || !box || !onPlaneChange) return;
    const point: [number, number, number] = [0, 0, 0];
    point[geom.u] = box.min[geom.u] + geom.uLen / 2;
    point[geom.v] = box.min[geom.v] + geom.vLen / 2;
    point[axis] = geom.planeCoord;
    const normal: [number, number, number] = [0, 0, 0];
    normal[axis] = 1;
    onPlaneChange({ point, normal });
  }, [geom, box, axis, onPlaneChange]);

  const samplePos = useCallback(
    (uFrac: number, vFrac: number): [number, number, number] | null => {
      if (!geom || !box) return null;
      const pos: [number, number, number] = [0, 0, 0];
      pos[geom.u] = box.min[geom.u] + uFrac * geom.uLen;
      pos[geom.v] = box.min[geom.v] + vFrac * geom.vLen;
      pos[axis] = geom.planeCoord;
      return pos;
    },
    [geom, box, axis],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !geom || !densitySampler) return;
    const { W, H } = geom;
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d");
    if (!g) return;
    const img = g.createImageData(W, H);
    const data = img.data;
    for (let py = 0; py < H; py++) {
      // +v points up on the canvas
      const vFrac = (H - 1 - py + 0.5) / H;
      for (let px = 0; px < W; px++) {
        const pos = samplePos((px + 0.5) / W, vFrac)!;
        // density grayscale is always the base layer — in "metric" mode it survives
        // (washed out) wherever the metric field carries no data, so a small scope
        // renders as a colored patch in a recognizable map instead of a blank box
        const shade = densityShade(densitySampler(pos[0], pos[1], pos[2]));
        let r = shade, gg = shade, b = shade;
        if (mode !== "density" && hasMetric) {
          const m = metricSampler!(pos[0], pos[1], pos[2]);
          if (!Number.isNaN(m)) {
            const [d0, d1] = metricDomain!;
            const t = d1 > d0 ? (m - d0) / (d1 - d0) : 0.5;
            const [mr, mg, mb] = rampColor(metricColors ?? [0x2166ac, 0xf7f7f7, 0xb2182b], t);
            // metric mode: pure ramp color; overlay: metric hue over density luminance
            const k = mode === "metric" ? 1 : 0.62;
            r = mr * k + r * (1 - k);
            gg = mg * k + gg * (1 - k);
            b = mb * k + b * (1 - k);
          } else if (mode === "metric") {
            const washed = 255 - (255 - shade) * 0.3;
            r = gg = b = washed;
          }
        }
        const o = (py * W + px) * 4;
        data[o] = r; data[o + 1] = gg; data[o + 2] = b; data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, [geom, densitySampler, metricSampler, metricDomain, metricColors, mode, hasMetric, samplePos]);

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!geom || !densitySampler) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const uFrac = (e.clientX - rect.left) / rect.width;
      const vFrac = 1 - (e.clientY - rect.top) / rect.height;
      const pos = samplePos(uFrac, vFrac);
      if (!pos) return;
      const d = densitySampler(pos[0], pos[1], pos[2]);
      const m = hasMetric ? metricSampler!(pos[0], pos[1], pos[2]) : NaN;
      const parts = [
        `(${pos[0].toFixed(1)}, ${pos[1].toFixed(1)}, ${pos[2].toFixed(1)})`,
        Number.isNaN(d) ? "2Fo-Fc: -" : `2Fo-Fc: ${d.toFixed(2)} sigma`,
      ];
      if (hasMetric) parts.push(Number.isNaN(m) ? `${metricLabel ?? "metric"}: -` : `${metricLabel ?? "metric"}: ${m.toFixed(2)}`);
      setReadout(parts.join("   "));
    },
    [geom, densitySampler, metricSampler, hasMetric, metricLabel, samplePos],
  );

  if (!box || !densitySampler) {
    return <div className="text-[11px] text-neutral-400">slice: density pending</div>;
  }

  return (
    <div className="flex flex-col gap-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="text-neutral-500">normal</span>
        {AXES.map((a, i) => (
          <label key={a} className="flex items-center gap-1">
            <input type="radio" checked={axis === i} onChange={() => setAxis(i as 0 | 1 | 2)} />
            <span>{a}</span>
          </label>
        ))}
        <select
          className="ml-auto rounded border border-neutral-300 bg-white px-1 py-0.5"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="overlay">overlay</option>
          <option value="metric">metric</option>
          <option value="density">density</option>
        </select>
      </div>
      <label className="flex items-center gap-2">
        <span className="whitespace-nowrap tabular-nums text-neutral-500">
          {AXES[axis]} = {(box.min[axis] + frac * (box.max[axis] - box.min[axis])).toFixed(1)} A
        </span>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0}
          max={1}
          step={0.005}
          value={frac}
          onChange={(e) => setFrac(Number(e.target.value))}
        />
      </label>
      <canvas
        ref={canvasRef}
        className="w-full rounded border border-neutral-200"
        style={{ aspectRatio: geom ? `${geom.W} / ${geom.H}` : undefined }}
        onMouseMove={onMove}
        onMouseLeave={() => setReadout(null)}
      />
      <div className="min-h-[1rem] whitespace-pre-wrap text-[10.5px] tabular-nums text-neutral-500">
        {readout ??
          (hasMetric
            ? `${metricLabel}: ${metricDomain![0].toFixed(2)} to ${metricDomain![1].toFixed(2)}; density gray ${DENSITY_SIGMA_RANGE[0]} to ${DENSITY_SIGMA_RANGE[1]} sigma`
            : `density gray ${DENSITY_SIGMA_RANGE[0]} to ${DENSITY_SIGMA_RANGE[1]} sigma; project a metric to overlay it`)}
      </div>
    </div>
  );
}
