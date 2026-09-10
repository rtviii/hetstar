"use client";
import { memo, useEffect, useMemo, useRef } from "react";

import { residueKey } from "@dynamic-pdb/hetkit/model";
import { hexCss, rampCss } from "@/lib/lab/color";
import { MODEL_A_COLOR } from "@/lib/molstar/style";
import type { LaneContext, LaneModule, LaneProps } from "./types";

// Per-position numeric lanes drawn on a canvas: the conformer count of model A and the
// active metric. Both take a Float32Array over positions (NaN = no value) and a color
// function; the shared draw routine handles bars, baselines, ticks and the in-lane title.

const COLOR_TICK = "#ececec";
const COLOR_TICK_LABEL = "#5f616b";
const COLOR_BASELINE = "#e5e7eb";
const COLOR_ZERO = "#d4d4d4";
const COLOR_UNSPLIT = "#c8cdd4";
const COLOR_LABEL = "#3d414f";

const CONFORMER_H = 56;
const METRIC_H = 36;

// count 2 -> the shared model color, max -> a deep bronze of the same family
const COUNT_RAMP = [MODEL_A_COLOR, 0x6f4a26];
const COLOR_BASE = hexCss(MODEL_A_COLOR);

function fmt(v: number): string {
  const a = Math.abs(v);
  return v.toFixed(a >= 10 ? 0 : a >= 1 ? 1 : 2);
}

// Size the canvas to the lane at device resolution and hand back a scaled context.
function prepare(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, width, height);
  return g;
}

function drawTitle(g: CanvasRenderingContext2D, title: string, x: number, y: number) {
  g.font = "9px monospace";
  g.textBaseline = "middle";
  g.textAlign = "left";
  const w = g.measureText(title).width;
  g.fillStyle = "rgba(255, 255, 255, 0.85)";
  g.fillRect(x - 2, y - 5.5, w + 5, 11);
  g.fillStyle = COLOR_LABEL;
  g.fillText(title, x, y);
}

// --- conformer count ---

function conformerCounts(ctx: LaneContext): { counts: Float32Array; max: number } {
  const { chain, confPlan } = ctx;
  const counts = new Float32Array(chain.length);
  let max = 2;
  chain.positions.forEach((p, i) => {
    if (!p.observed || !p.ref) {
      counts[i] = NaN;
      return;
    }
    const c = confPlan.byKey.get(residueKey(p.ref))?.altIds.length ?? 1;
    counts[i] = c;
    if (c > max) max = c;
  });
  return { counts, max };
}

const ConformerLaneView = memo(function ConformerLaneView({ ctx, view }: LaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { counts, max } = useMemo(() => conformerCounts(ctx), [ctx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || view.width < 2) return;
    const g = prepare(canvas, view.width, CONFORMER_H);
    if (!g) return;
    const n = counts.length;
    const barW = view.width / n;
    const denom = Math.max(2, max);
    const barH = (count: number) => Math.max(4, (count / denom) * (CONFORMER_H - 8));

    // integer y ticks, at most ~4 lines
    const step = Math.max(1, Math.ceil((denom - 2) / 3));
    const ticks: number[] = [];
    for (let c = 2; c < denom; c += step) ticks.push(c);
    if (!ticks.includes(denom)) ticks.push(denom);
    g.font = "9px monospace";
    g.textBaseline = "middle";
    for (const c of ticks) {
      const y = Math.round(CONFORMER_H - barH(c)) + 0.5;
      g.strokeStyle = COLOR_TICK;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(view.width, y);
      g.stroke();
    }
    g.strokeStyle = COLOR_BASELINE;
    g.beginPath();
    g.moveTo(0, CONFORMER_H - 0.5);
    g.lineTo(view.width, CONFORMER_H - 0.5);
    g.stroke();

    const w = Math.max(0.75, barW - (barW > 2.5 ? 0.75 : 0));
    for (let i = 0; i < n; i++) {
      const c = counts[i];
      if (Number.isNaN(c)) continue;
      const h = c <= 1 ? 3 : barH(c);
      g.fillStyle = c <= 1 ? COLOR_UNSPLIT : c <= 2 ? COLOR_BASE : rampCss(COUNT_RAMP, (c - 2) / Math.max(1, denom - 2));
      g.fillRect(i * barW, CONFORMER_H - h, w, h);
    }
    // tick labels last, backed, so they read over the bars
    for (const c of ticks) {
      const y = Math.round(CONFORMER_H - barH(c)) + 0.5;
      drawTitle(g, String(c), 3, y);
    }
  }, [counts, max, view.width]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width: view.width, height: CONFORMER_H }} />;
});

export const conformerLane: LaneModule = {
  id: "conformers",
  label: "conformers",
  description: "conformers per residue in model A (heavy-atom altloc letters); gray stubs are single-conformer residues",
  defaultOn: true,
  height: CONFORMER_H,
  unavailable: (ctx) => (ctx.aTable ? null : "load a model"),
  Component: ConformerLaneView,
  readout: (ctx, pos) => {
    const p = ctx.chain.positions[pos - 1];
    if (!p?.ref || !p.observed) return null;
    const c = ctx.confPlan.byKey.get(residueKey(p.ref))?.altIds.length ?? 1;
    return `${c} conformer${c === 1 ? "" : "s"}`;
  },
};

// --- active metric ---

function metricValues(ctx: LaneContext): Float32Array | null {
  const m = ctx.metric;
  if (!m) return null;
  const byKey = new Map<string, number>();
  m.track.keys.forEach((k, i) => byKey.set(residueKey(k), m.track.values[i]));
  const out = new Float32Array(ctx.chain.length);
  ctx.chain.positions.forEach((p, i) => {
    out[i] = p.ref ? (byKey.get(residueKey(p.ref)) ?? NaN) : NaN;
  });
  return out;
}

const MetricLaneView = memo(function MetricLaneView({ ctx, view }: LaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const values = useMemo(() => metricValues(ctx), [ctx]);
  const metric = ctx.metric;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !values || !metric || view.width < 2) return;
    const g = prepare(canvas, view.width, METRIC_H);
    if (!g) return;
    const n = values.length;
    const barW = view.width / n;
    const [d0, d1] = metric.track.domain;
    const span = d1 - d0;
    const yOf = (v: number) => {
      const t = span > 0 ? (v - d0) / span : 0.5;
      return METRIC_H - Math.min(1, Math.max(0, t)) * METRIC_H;
    };
    // diverging domains draw from the zero line, sequential from the lane floor
    const diverging = d0 < 0 && d1 > 0;
    const baseY = diverging ? yOf(0) : METRIC_H;
    if (diverging) {
      g.strokeStyle = COLOR_ZERO;
      g.beginPath();
      g.moveTo(0, Math.round(baseY) + 0.5);
      g.lineTo(view.width, Math.round(baseY) + 0.5);
      g.stroke();
    }
    const w = Math.max(0.75, barW - (barW > 2.5 ? 0.75 : 0));
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (Number.isNaN(v)) continue;
      const t = span > 0 ? (v - d0) / span : 0.5;
      const y = yOf(v);
      g.fillStyle = rampCss(metric.colors, t);
      g.fillRect(i * barW, Math.min(y, baseY), w, Math.max(1, Math.abs(baseY - y)));
    }
    g.fillStyle = COLOR_TICK_LABEL;
    g.font = "9px monospace";
    g.textBaseline = "middle";
    g.textAlign = "right";
    g.fillText(fmt(d1), view.width - 3, 6);
    g.fillText(fmt(d0), view.width - 3, METRIC_H - 6);
    drawTitle(g, `${metric.name}${metric.unit ? ` (${metric.unit})` : ""}`, 3, 7);
  }, [values, metric, view.width]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width: view.width, height: METRIC_H }} />;
});

export const metricLane: LaneModule = {
  id: "metric",
  label: "metric",
  description: "the metric projected onto the density, in its own ramp so the lane matches the 3D paint",
  defaultOn: true,
  height: METRIC_H,
  unavailable: (ctx) => (ctx.metric ? null : "project a metric first"),
  Component: MetricLaneView,
  readout: (ctx, pos) => {
    const m = ctx.metric;
    const p = ctx.chain.positions[pos - 1];
    if (!m || !p?.ref) return null;
    const key = residueKey(p.ref);
    const i = m.track.keys.findIndex((k) => residueKey(k) === key);
    if (i < 0 || Number.isNaN(m.track.values[i])) return null;
    return `${m.name} ${m.track.values[i].toFixed(2)}${m.unit ? ` ${m.unit}` : ""}`;
  },
};
