"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hexCss, rampCss } from "@/lib/lab/color";
import { MODEL_A_COLOR } from "@/lib/molstar/style";

// 1D per-residue strip for model A in file order, two lanes over a shared x-axis:
//  - conformer count bars (base color = MODEL_A_COLOR, the 3D model color, deepening
//    with count; visible gray stubs for unsplit residues; integer y-ticks), and
//  - when a metric is projected, the active metric track (same residue order, colored by
//    the metric's own ramp so the lane matches the 3D paint; NaN renders as a gap),
//    titled with the metric's name inside the lane.
// Chain boundaries get a rule + label; the chain band carries seq-number x ticks. Click
// selects the residue in 3D (green marker, matching Mol*'s select tint), hover highlights,
// dragging selects a residue RANGE (clamped to the chain the drag started in), mirrored
// into 3D and the metric scope by the parent. Hit-testing spans both lanes.

export interface ConformerBar {
  key: string; // residueKey (chain|seq|ins)
  chain: string;
  seq: number;
  ins: string;
  compId: string;
  count: number;
}

export interface BarRange {
  chain: string;
  from: number;
  to: number;
}

const GUTTER_W = 34; // y-tick + metric-domain labels
const BAR_AREA_H = 56;
const LANE_GAP = 5;
const METRIC_LANE_H = 36;
const CHAIN_BAND_H = 16; // chain labels + seq-number x ticks

const COLOR_UNSPLIT = "#c8cdd4";
const COLOR_SELECT = "#22a747"; // legible echo of Mol*'s green select marker in 3D
const COLOR_HOVER = "#0369a1";
const COLOR_BASELINE = "#e5e7eb";
const COLOR_TICK = "#ececec";
const COLOR_TICK_LABEL = "#9ca3af";
const COLOR_RULE = "#a3a3a3";
const COLOR_LABEL = "#525252";
const COLOR_ZERO = "#d4d4d4";
const COLOR_RANGE_BAND = "rgba(34, 167, 71, 0.15)";

// count 2 -> the shared model color, maxCount -> a deep bronze of the same family
const COUNT_RAMP = [MODEL_A_COLOR, 0x6f4a26];
const COLOR_BASE = hexCss(MODEL_A_COLOR);

function countColor(count: number, maxCount: number): string {
  if (count <= 2) return COLOR_BASE;
  const t = maxCount > 2 ? (count - 2) / (maxCount - 2) : 0;
  return rampCss(COUNT_RAMP, t);
}

function fmtDomain(v: number): string {
  const a = Math.abs(v);
  return v.toFixed(a >= 10 ? 0 : a >= 1 ? 1 : 2);
}

export default function ConformerBarplot({
  bars,
  maxCount,
  selectedKey,
  selectedRange,
  hoverKey,
  metricValues,
  metricDomain,
  metricColors,
  metricName,
  metricUnit,
  onHover,
  onSelect,
  onRangeSelect,
}: {
  bars: ConformerBar[] | null;
  maxCount: number;
  selectedKey: string | null;
  /** committed range selection (drawn as a band) */
  selectedRange: BarRange | null;
  /** residue hovered in 3D (mirrored onto the strip) */
  hoverKey: string | null;
  /** active metric track values, parallel to `bars` (NaN = gap); null hides the lane */
  metricValues: Float32Array | null;
  metricDomain: [number, number] | null;
  metricColors: number[] | null;
  metricName: string | null;
  metricUnit: string | null;
  onHover: (bar: ConformerBar | null) => void;
  onSelect: (bar: ConformerBar) => void;
  onRangeSelect: (range: BarRange) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [localHover, setLocalHover] = useState<number | null>(null);
  const lastHoverIndexRef = useRef<number | null>(null);
  const dragStartRef = useRef<number | null>(null);
  const [dragSpan, setDragSpan] = useState<[number, number] | null>(null);

  const hasMetric = !!(metricValues && metricDomain && metricColors);
  const chainTop = BAR_AREA_H + (hasMetric ? LANE_GAP + METRIC_LANE_H : 0);
  const canvasH = chainTop + CHAIN_BAND_H;

  // The wrapper div renders UNCONDITIONALLY (the empty state lives inside it) so this
  // mount-only observer actually attaches — with the ref inside a data-gated branch the
  // observer never registered and the canvas stayed at width 0, i.e. blank, forever.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const indexByKey = useMemo(() => {
    const m = new Map<string, number>();
    bars?.forEach((b, i) => m.set(b.key, i));
    return m;
  }, [bars]);

  // committed-range index span (contiguous per chain since bars are in file order)
  const rangeSpan = useMemo((): [number, number] | null => {
    if (!bars || !selectedRange) return null;
    let first = -1;
    let last = -1;
    bars.forEach((b, i) => {
      if (b.chain !== selectedRange.chain || b.seq < selectedRange.from || b.seq > selectedRange.to) return;
      if (first < 0) first = i;
      last = i;
    });
    return first >= 0 ? [first, last] : null;
  }, [bars, selectedRange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bars || !bars.length || width < 10) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(canvasH * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, canvasH);

    const n = bars.length;
    const plotW = width - GUTTER_W;
    if (plotW < 10) return;
    const barW = plotW / n;
    const xOf = (i: number) => GUTTER_W + i * barW;
    const denom = Math.max(2, maxCount);
    const barH = (count: number) => Math.max(4, (count / denom) * (BAR_AREA_H - 8));

    // range band (in-flight drag wins over the committed range), across both lanes
    const band = dragSpan ?? rangeSpan;
    if (band) {
      const [a, b] = band[0] <= band[1] ? band : [band[1], band[0]];
      g.fillStyle = COLOR_RANGE_BAND;
      g.fillRect(xOf(a), 0, (b - a + 1) * barW, chainTop);
    }

    // y ticks for the count lane: integer counts, at most ~4 lines
    g.font = "9px monospace";
    g.textBaseline = "middle";
    const tickStep = Math.max(1, Math.ceil((denom - 2) / 3));
    const ticks: number[] = [];
    for (let c = 2; c < denom; c += tickStep) ticks.push(c);
    if (!ticks.includes(denom)) ticks.push(denom);
    for (const c of ticks) {
      const y = Math.round(BAR_AREA_H - barH(c)) + 0.5;
      g.strokeStyle = COLOR_TICK;
      g.beginPath();
      g.moveTo(GUTTER_W, y);
      g.lineTo(width, y);
      g.stroke();
      g.fillStyle = COLOR_TICK_LABEL;
      g.textAlign = "right";
      g.fillText(String(c), GUTTER_W - 4, y);
    }
    g.textAlign = "left";

    // baseline under the count bars
    g.strokeStyle = COLOR_BASELINE;
    g.beginPath();
    g.moveTo(GUTTER_W, BAR_AREA_H - 0.5);
    g.lineTo(width, BAR_AREA_H - 0.5);
    g.stroke();

    // count bars
    for (let i = 0; i < n; i++) {
      const b = bars[i];
      const x = xOf(i);
      const isSelected = b.key === selectedKey;
      const h = b.count <= 1 ? 3 : barH(b.count);
      g.fillStyle = b.count <= 1 ? COLOR_UNSPLIT : countColor(b.count, denom);
      g.fillRect(x, BAR_AREA_H - h, Math.max(0.75, barW - (barW > 2.5 ? 0.75 : 0)), h);
      if (isSelected) {
        // green select marker matching the 3D selection: outline + triangle, bar keeps its color
        g.strokeStyle = COLOR_SELECT;
        g.lineWidth = 1.5;
        g.strokeRect(x + 0.25, BAR_AREA_H - h - 0.75, Math.max(1.5, barW - 0.5), h + 0.75);
        g.lineWidth = 1;
        const cx = x + barW / 2;
        g.fillStyle = COLOR_SELECT;
        g.beginPath();
        g.moveTo(cx - 3.5, 2);
        g.lineTo(cx + 3.5, 2);
        g.lineTo(cx, 8);
        g.closePath();
        g.fill();
      }
    }

    // metric lane
    if (hasMetric && metricValues && metricDomain && metricColors) {
      const laneTop = BAR_AREA_H + LANE_GAP;
      const laneBottom = laneTop + METRIC_LANE_H;
      const [d0, d1] = metricDomain;
      const span = d1 - d0;
      const yOf = (v: number) => {
        const t = span > 0 ? (v - d0) / span : 0.5;
        return laneBottom - Math.min(1, Math.max(0, t)) * METRIC_LANE_H;
      };
      // lane frame
      g.strokeStyle = COLOR_TICK;
      for (const y of [laneTop + 0.5, laneBottom - 0.5]) {
        g.beginPath();
        g.moveTo(GUTTER_W, y);
        g.lineTo(width, y);
        g.stroke();
      }
      // diverging domains draw from the zero line, sequential from the lane floor
      const diverging = d0 < 0 && d1 > 0;
      const baseY = diverging ? yOf(0) : laneBottom;
      if (diverging) {
        g.strokeStyle = COLOR_ZERO;
        g.beginPath();
        g.moveTo(GUTTER_W, Math.round(baseY) + 0.5);
        g.lineTo(width, Math.round(baseY) + 0.5);
        g.stroke();
      }
      for (let i = 0; i < n; i++) {
        const v = metricValues[i];
        if (Number.isNaN(v)) continue;
        const t = span > 0 ? (v - d0) / span : 0.5;
        const y = yOf(v);
        g.fillStyle = rampCss(metricColors, t);
        const top = Math.min(y, baseY);
        const h = Math.max(1, Math.abs(baseY - y));
        g.fillRect(xOf(i), top, Math.max(0.75, barW - (barW > 2.5 ? 0.75 : 0)), h);
      }
      // domain labels in the gutter
      g.fillStyle = COLOR_TICK_LABEL;
      g.textAlign = "right";
      g.fillText(fmtDomain(d1), GUTTER_W - 4, laneTop + 5);
      g.fillText(fmtDomain(d0), GUTTER_W - 4, laneBottom - 5);
      g.textAlign = "left";
      // lane title (the metric's name), white-backed so it stays legible over the bars
      const title = `${metricName ?? "metric"}${metricUnit ? ` (${metricUnit})` : ""}`;
      const tw = g.measureText(title).width;
      g.fillStyle = "rgba(255, 255, 255, 0.85)";
      g.fillRect(GUTTER_W + 2, laneTop + 1.5, tw + 6, 11);
      g.fillStyle = COLOR_LABEL;
      g.fillText(title, GUTTER_W + 5, laneTop + 7);
    }

    // chain boundaries + labels
    g.font = "10px monospace";
    for (let i = 0; i < n; i++) {
      if (i > 0 && bars[i].chain !== bars[i - 1].chain) {
        const x = Math.round(xOf(i)) + 0.5;
        g.strokeStyle = COLOR_RULE;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, canvasH);
        g.stroke();
      }
      if (i === 0 || bars[i].chain !== bars[i - 1].chain) {
        g.fillStyle = COLOR_LABEL;
        g.fillText(bars[i].chain, xOf(i) + 3, chainTop + CHAIN_BAND_H / 2);
      }
    }

    // x axis in the chain band: unlabeled minor ticks at every 10th auth seq, labels at
    // a nice step (>= 10) chosen so they keep ~44px spacing. Per chain segment.
    const NICE_STEPS = [10, 20, 50, 100, 200, 500, 1000];
    const labelStep = NICE_STEPS.find((s) => s * barW >= 44) ?? 1000;
    const minorTicks = 10 * barW >= 7; // skip 10-ticks once they would smear together
    g.font = "9px monospace";
    g.textAlign = "center";
    let labelClearX = -Infinity; // labels (chain letters included) may not cross this
    for (let i = 0; i < n; i++) {
      const b = bars[i];
      if (i === 0 || bars[i - 1].chain !== b.chain) labelClearX = xOf(i) + 14; // room for the chain letter
      if (b.seq % 10 !== 0) continue;
      if (i > 0 && bars[i - 1].chain === b.chain && bars[i - 1].seq === b.seq) continue; // insertion-code duplicate
      const labeled = b.seq % labelStep === 0;
      if (!labeled && !minorTicks) continue;
      const cx = Math.round(xOf(i) + barW / 2) + 0.5;
      g.strokeStyle = COLOR_ZERO;
      g.beginPath();
      g.moveTo(cx, chainTop);
      g.lineTo(cx, chainTop + (labeled ? 3.5 : 2));
      g.stroke();
      if (!labeled) continue;
      const label = String(b.seq);
      const half = label.length * 2.8 + 3;
      if (cx - half < labelClearX) continue; // tick stays, label yields
      g.fillStyle = COLOR_TICK_LABEL;
      g.fillText(label, cx, chainTop + 10);
      labelClearX = cx + half;
    }
    g.textAlign = "left";

    // hover outline (3D-driven or local), spanning both lanes
    const hoverIndex = localHover ?? (hoverKey != null ? (indexByKey.get(hoverKey) ?? null) : null);
    if (hoverIndex != null && hoverIndex >= 0 && hoverIndex < n) {
      g.strokeStyle = COLOR_HOVER;
      g.lineWidth = 1;
      g.strokeRect(xOf(hoverIndex) + 0.5, 0.5, Math.max(1, barW - 1), chainTop - 1);
    }
  }, [
    bars, maxCount, width, canvasH, chainTop, selectedKey, hoverKey, localHover, indexByKey,
    dragSpan, rangeSpan, hasMetric, metricValues, metricDomain, metricColors, metricName, metricUnit,
  ]);

  const indexAt = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): number | null => {
      if (!bars || !bars.length) return null;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left - GUTTER_W;
      const plotW = rect.width - GUTTER_W;
      if (x < 0 || plotW <= 0) return null;
      const index = Math.floor((x / plotW) * bars.length);
      if (index < 0 || index >= bars.length) return null;
      return index;
    },
    [bars],
  );

  // clamp an index to the chain segment the drag started in
  const clampToChain = useCallback(
    (index: number, startIndex: number): number => {
      if (!bars) return index;
      const chain = bars[startIndex].chain;
      let i = index;
      if (i < startIndex) while (i < startIndex && bars[i].chain !== chain) i++;
      else while (i > startIndex && bars[i].chain !== chain) i--;
      return i;
    },
    [bars],
  );

  const handleDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const i = indexAt(e);
      if (i == null) return;
      dragStartRef.current = i;
      setDragSpan([i, i]);
    },
    [indexAt],
  );

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const index = indexAt(e);
      const start = dragStartRef.current;
      if (start != null && index != null) {
        setDragSpan([start, clampToChain(index, start)]);
      }
      if (index === lastHoverIndexRef.current) return;
      lastHoverIndexRef.current = index;
      setLocalHover(index);
      onHover(index != null && bars ? bars[index] : null);
    },
    [indexAt, clampToChain, bars, onHover],
  );

  const handleUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      setDragSpan(null);
      if (start == null || !bars) return;
      const raw = indexAt(e);
      const end = raw == null ? start : clampToChain(raw, start);
      if (end === start) {
        onSelect(bars[start]);
        return;
      }
      const [a, b] = start <= end ? [start, end] : [end, start];
      onRangeSelect({
        chain: bars[start].chain,
        from: Math.min(bars[a].seq, bars[b].seq),
        to: Math.max(bars[a].seq, bars[b].seq),
      });
    },
    [bars, indexAt, clampToChain, onSelect, onRangeSelect],
  );

  const handleLeave = useCallback(() => {
    dragStartRef.current = null;
    setDragSpan(null);
    lastHoverIndexRef.current = null;
    setLocalHover(null);
    onHover(null);
  }, [onHover]);

  const readoutIndex =
    localHover ??
    (hoverKey != null ? (indexByKey.get(hoverKey) ?? null) : null) ??
    (selectedKey != null ? (indexByKey.get(selectedKey) ?? null) : null);
  const readoutBar = readoutIndex != null && bars ? (bars[readoutIndex] ?? null) : null;
  const readoutMetric =
    readoutIndex != null && hasMetric && metricValues && !Number.isNaN(metricValues[readoutIndex])
      ? `${metricName ?? "metric"} ${metricValues[readoutIndex].toFixed(2)}${metricUnit ? ` ${metricUnit}` : ""}`
      : null;

  return (
    <div ref={wrapRef} className="flex min-w-0 flex-col gap-1">
      {!bars || !bars.length ? (
        <div className="text-[11px] text-neutral-400">Conformers per residue: load a model.</div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: canvasH }}
            className="cursor-pointer"
            onMouseDown={handleDown}
            onMouseMove={handleMove}
            onMouseUp={handleUp}
            onMouseLeave={handleLeave}
          />
          <div className="min-h-[1rem] text-[10.5px] tabular-nums text-neutral-500">
            {readoutBar
              ? `${readoutBar.compId} ${readoutBar.chain}/${readoutBar.seq} — ${readoutBar.count} conformer${readoutBar.count === 1 ? "" : "s"}${readoutMetric ? ` · ${readoutMetric}` : ""}`
              : hasMetric && metricDomain
                ? `${metricName ?? "metric"}: ${fmtDomain(metricDomain[0])} to ${fmtDomain(metricDomain[1])}${metricUnit ? ` ${metricUnit}` : ""} — click a bar to select, drag to select a range`
                : "conformers per residue (model A); click a bar to select, drag to select a range"}
          </div>
        </>
      )}
    </div>
  );
}
