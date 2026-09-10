"use client";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { positionOf, refAt } from "@dynamic-pdb/hetkit/model";
import type { AtomTable, ChainSequence, ResidueRef, SecondarySpan, SequenceModel } from "@dynamic-pdb/hetkit/model";
import type { ConformerPlan, ResidueRange } from "@/lib/molstar/conformers";
import { PinPopover, TinyText } from "../compare/ui";
import { defaultEnabledLanes, LANE_MODULES } from "./registry";
import type { LaneContext, LaneMetric, LaneModule, LaneView, PositionSpan } from "./types";

// The sequence lanes host: one chain at a time, a ruler in author numbering, and one
// row per enabled lane module, all sharing the chain's positions as x. Fitted to its
// column until zoomed (buttons or trackpad pinch), then it scrolls sideways with the
// row labels staying put. Hover and selection are painted as columns over the whole
// board, so a column read down the rows is one residue.
//
// The bridge to the structure is the SequenceModel: every hover, click and drag here
// leaves as an author-keyed residue or range (what Mol*, the metrics and the popup
// speak), and every 3D pick arrives the same way and is placed by positionOf. Nothing
// in the lanes knows about Mol*.

const GUTTER_L = 96;
const GUTTER_R = 12;
const RULER_H = 20;
const ZOOMS = [5, 8, 11, 14, 18, 24];
const MAX_ZOOM = ZOOMS[ZOOMS.length - 1];
const PINCH = 100;
const STORAGE_KEY = "hetstar.lanes.enabled";
const COLOR_SELECTION = "rgba(34, 167, 71, 0.2)"; // Mol*'s select green, washed
const COLOR_HOVER = "rgba(102, 59, 228, 0.14)"; // the accent

function loadEnabled(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
    }
  } catch {
    /* no storage: defaults */
  }
  return defaultEnabledLanes();
}

function saveEnabled(set: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

interface Tick {
  pos: number;
  label: string | null;
}

// Ticks in author numbering (what the 3D viewer and metrics speak), positions when the
// chain carries none: labels at a step that keeps ~44 px between them, unlabeled minor
// ticks every 10 once those would not smear together. Insertion-code duplicates skipped.
function rulerTicks(chain: ChainSequence, cell: number): Tick[] {
  const NICE = [10, 20, 50, 100, 200, 500, 1000];
  const step = NICE.find((s) => s * cell >= 44) ?? 1000;
  const minor = 10 * cell >= 7;
  const numbered = chain.posByKey.size > 0;
  const out: Tick[] = [];
  let prev: number | null = null;
  for (const p of chain.positions) {
    const n = numbered ? (p.ref?.seq ?? null) : p.pos;
    if (n === null || n === prev) continue;
    prev = n;
    if (n % 10 !== 0) continue;
    const labeled = n % step === 0;
    if (!labeled && !minor) continue;
    out.push({ pos: p.pos, label: labeled ? String(n) : null });
  }
  return out;
}

function spanOfRange(chain: ChainSequence, range: ResidueRange | null): PositionSpan | null {
  if (!range || range.chain !== chain.chain) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const p of chain.positions) {
    if (!p.ref || p.ref.seq < range.from || p.ref.seq > range.to) continue;
    if (p.pos < start) start = p.pos;
    if (p.pos > end) end = p.pos;
  }
  return Number.isFinite(start) ? { start, end } : null;
}

function rangeOfSpan(chain: ChainSequence, span: PositionSpan): ResidueRange | null {
  let from = Infinity;
  let to = -Infinity;
  for (let pos = span.start; pos <= span.end; pos++) {
    const ref = refAt(chain, pos);
    if (!ref) continue;
    if (ref.seq < from) from = ref.seq;
    if (ref.seq > to) to = ref.seq;
  }
  return Number.isFinite(from) ? { chain: chain.chain, from, to } : null;
}

function Row({
  label,
  height,
  children,
  trackRef,
  plain,
}: {
  label: string;
  height: number;
  children: ReactNode;
  trackRef?: (el: HTMLDivElement | null) => void;
  /** no lane ground (the ruler) */
  plain?: boolean;
}) {
  return (
    <div className="grid items-center" style={{ gridTemplateColumns: "var(--gl) var(--lane) var(--gr)" }}>
      <span className="sticky left-0 z-10 flex h-full items-center justify-end whitespace-nowrap bg-white pr-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-ink-secondary">
        {label}
      </span>
      <div ref={trackRef} className={`relative ${plain ? "" : "bg-surface-muted"}`} style={{ height }}>
        {children}
      </div>
      <span />
    </div>
  );
}

function Column({ span, length, color }: { span: PositionSpan; length: number; color: string }) {
  const n = Math.max(1, length);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-0 top-0 z-[5]"
      style={{
        left: `calc(var(--gl) + ${(span.start - 1) / n} * (100% - var(--gl) - var(--gr)))`,
        width: `max(2px, calc(${(span.end - span.start + 1) / n} * (100% - var(--gl) - var(--gr))))`,
        background: color,
      }}
    />
  );
}

export default function SequenceLanes({
  model,
  aTable,
  confPlan,
  secondaryByChain,
  metric,
  hoverRef,
  selection,
  onHover,
  onSelect,
  leading,
}: {
  model: SequenceModel | null;
  aTable: AtomTable | null;
  confPlan: ConformerPlan;
  secondaryByChain: Map<string, SecondarySpan[]> | null;
  metric: LaneMetric | null;
  /** residue hovered in 3D, mirrored as a column */
  hoverRef: ResidueRef | null;
  /** the committed selection (a single residue is from === to) */
  selection: ResidueRange | null;
  onHover: (ref: ResidueRef | null) => void;
  /** a click gives from === to; a drag or a feature click gives the range */
  onSelect: (range: ResidueRange) => void;
  /** rendered at the left of the toolbar (the section label, the selection chip) */
  leading?: ReactNode;
}) {
  const [activeChain, setActiveChain] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitWidth, setFitWidth] = useState(0);
  const [enabled, setEnabled] = useState<Set<string>>(defaultEnabledLanes);
  const [localHover, setLocalHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [laneNode, setLaneNode] = useState<HTMLDivElement | null>(null);
  const dragStartRef = useRef<number | null>(null);
  const lastHoverRef = useRef<number | null>(null);
  const anchorRef = useRef<{ fraction: number; clientX: number } | null>(null);

  useEffect(() => setEnabled(loadEnabled()), []);

  // the active chain follows the model (keep it while it exists) and the selection
  useEffect(() => {
    if (!model || model.chains.length === 0) {
      setActiveChain(null);
      return;
    }
    setActiveChain((prev) => (prev && model.byChain.has(prev) ? prev : model.chains[0].chain));
  }, [model]);
  useEffect(() => {
    if (selection && model?.byChain.has(selection.chain)) setActiveChain(selection.chain);
  }, [selection, model]);

  const chain = activeChain && model ? (model.byChain.get(activeChain) ?? null) : null;

  const ctx = useMemo<LaneContext | null>(
    () =>
      chain
        ? { chain, aTable, confPlan, secondary: secondaryByChain?.get(chain.chain) ?? null, metric }
        : null,
    [chain, aTable, confPlan, secondaryByChain, metric],
  );

  // fitted lane width: the scrollport less the two gutters
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const measure = () => setFitWidth(Math.max(0, el.clientWidth - GUTTER_L - GUTTER_R));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [model]);

  const length = chain?.length ?? 0;
  const fitCell = length > 0 && fitWidth > 0 ? fitWidth / length : null;
  const laneWidth = zoom !== null ? length * zoom : fitWidth;
  const view = useMemo<LaneView>(
    () => ({ length, width: laneWidth, cell: length > 0 ? laneWidth / length : 0 }),
    [length, laneWidth],
  );

  // trackpad pinch (a wheel event with ctrlKey) zooms about the residue under the pointer
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !laneNode || fitCell === null) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const box = laneNode.getBoundingClientRect();
      anchorRef.current = { fraction: (e.clientX - box.left) / box.width, clientX: e.clientX };
      const factor = Math.exp(-e.deltaY / PINCH);
      setZoom((prev) => {
        const next = (prev ?? fitCell) * factor;
        return next <= fitCell ? null : Math.min(next, MAX_ZOOM);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [laneNode, fitCell]);
  useEffect(() => {
    const held = anchorRef.current;
    anchorRef.current = null;
    const el = viewerRef.current;
    if (!el || !laneNode || !held) return;
    const box = laneNode.getBoundingClientRect();
    el.scrollLeft += box.left + held.fraction * box.width - held.clientX;
  }, [zoom, laneNode]);

  const zoomIn = () => setZoom((prev) => ZOOMS.find((r) => (prev ?? fitCell ?? 0) < r) ?? MAX_ZOOM);
  const zoomOut = () =>
    setZoom((prev) => {
      if (prev === null) return null;
      const rungs = ZOOMS.filter((r) => r < prev && (fitCell === null || r > fitCell));
      return rungs.length ? rungs[rungs.length - 1] : null;
    });

  // --- hit-testing: pointer x to position ---

  const posAt = useCallback(
    (clientX: number, clamp: boolean): number | null => {
      if (!laneNode || length === 0) return null;
      const box = laneNode.getBoundingClientRect();
      const raw = Math.floor(((clientX - box.left) / box.width) * length) + 1;
      if (clamp) return Math.min(length, Math.max(1, raw));
      return raw >= 1 && raw <= length ? raw : null;
    },
    [laneNode, length],
  );

  const emitHover = useCallback(
    (pos: number | null) => {
      if (pos === lastHoverRef.current) return;
      lastHoverRef.current = pos;
      setLocalHover(pos);
      const p = pos && chain ? chain.positions[pos - 1] : null;
      onHover(p && p.observed ? p.ref : null);
    },
    [chain, onHover],
  );

  const selectSpan = useCallback(
    (span: PositionSpan) => {
      if (!chain) return;
      const range = rangeOfSpan(chain, span);
      if (range) onSelect(range);
    },
    [chain, onSelect],
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const pos = posAt(e.clientX, false);
    if (pos === null) return;
    dragStartRef.current = pos;
    setDrag([pos, pos]);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const start = dragStartRef.current;
    if (start !== null) setDrag([start, posAt(e.clientX, true) ?? start]);
    emitHover(posAt(e.clientX, false));
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setDrag(null);
    if (start === null || !chain) return;
    const end = posAt(e.clientX, true) ?? start;
    if (end === start) {
      const p = chain.positions[start - 1];
      if (p?.ref && p.observed) onSelect({ chain: chain.chain, from: p.ref.seq, to: p.ref.seq });
      return;
    }
    selectSpan(start <= end ? { start, end } : { start: end, end: start });
  };
  const onMouseLeave = () => {
    dragStartRef.current = null;
    setDrag(null);
    emitHover(null);
  };

  // --- what is painted ---

  const selectionSpan = useMemo(() => (chain ? spanOfRange(chain, selection) : null), [chain, selection]);
  const hoverPos =
    localHover ?? (hoverRef && chain && hoverRef.chain === chain.chain && model ? positionOf(model, hoverRef) : null);
  const dragSpan: PositionSpan | null = drag ? { start: Math.min(drag[0], drag[1]), end: Math.max(drag[0], drag[1]) } : null;

  const lanes = useMemo(
    () => (ctx ? LANE_MODULES.filter((m) => enabled.has(m.id) && m.unavailable(ctx) === null) : []),
    [ctx, enabled],
  );

  const toggleLane = (id: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveEnabled(next);
      return next;
    });

  const readout = useMemo(() => {
    if (!ctx) return null;
    const pos = hoverPos;
    if (pos === null) return null;
    const parts: string[] = [];
    for (const m of lanes) {
      const r = m.readout?.(ctx, pos);
      if (r) parts.push(r);
    }
    return parts.join(" · ");
  }, [ctx, hoverPos, lanes]);

  const ticks = useMemo(() => (chain ? rulerTicks(chain, view.cell) : []), [chain, view.cell]);

  const drawer = (
    <div className="flex flex-col gap-1.5">
      <div className="font-medium text-ink-secondary">lanes</div>
      {LANE_MODULES.map((m: LaneModule) => {
        const why = ctx ? m.unavailable(ctx) : "load a model";
        return (
          <label key={m.id} className={`flex items-start gap-1.5 ${why ? "opacity-50" : ""}`}>
            <input type="checkbox" className="mt-0.5" checked={enabled.has(m.id)} disabled={!!why} onChange={() => toggleLane(m.id)} />
            <span className="flex flex-col">
              <span className="text-ink-secondary">{m.label}</span>
              <span className="text-[10.5px] text-ink-muted/75">{why ?? m.description}</span>
            </span>
          </label>
        );
      })}
      <TinyText>a lane stays on even while it has nothing to draw (the metric lane returns with the next projection)</TinyText>
    </div>
  );

  const boardStyle = {
    "--gl": `${GUTTER_L}px`,
    "--gr": `${GUTTER_R}px`,
    "--lane": zoom !== null ? `${laneWidth}px` : "minmax(0, 1fr)",
    width: zoom !== null ? `${laneWidth + GUTTER_L + GUTTER_R}px` : "100%",
  } as CSSProperties;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {leading}
        {model && chain && (
          <>
            <select
              className="rounded border border-line-strong bg-white px-1 py-0.5 font-mono focus:border-accent focus:outline-none focus:shadow-ring-accent"
              value={chain.chain}
              onChange={(e) => setActiveChain(e.target.value)}
              aria-label="chain"
            >
              {model.chains.map((c) => (
                <option key={c.chain} value={c.chain}>
                  chain {c.chain} · {c.length} res{c.entityId ? ` · entity ${c.entityId}` : ""}
                </option>
              ))}
            </select>
            <span className="inline-flex overflow-hidden rounded border border-line-strong bg-white" role="group" aria-label="zoom">
              <button type="button" className="px-1.5 py-0.5 text-ink-secondary hover:bg-accent-soft disabled:opacity-40" onClick={zoomOut} disabled={zoom === null} aria-label="zoom out">
                &minus;
              </button>
              <button
                type="button"
                className={`border-l border-line-strong px-1.5 py-0.5 hover:bg-accent-soft ${zoom === null ? "bg-accent-soft text-accent" : "text-ink-secondary"}`}
                onClick={() => setZoom(null)}
              >
                fit
              </button>
              <button
                type="button"
                className="border-l border-line-strong px-1.5 py-0.5 text-ink-secondary hover:bg-accent-soft disabled:opacity-40"
                onClick={zoomIn}
                disabled={zoom !== null && zoom >= MAX_ZOOM}
                aria-label="zoom in"
              >
                +
              </button>
            </span>
            <PinPopover content={drawer} width={320}>
              <span className="text-[10.5px] text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink-secondary">
                lanes ({lanes.length})
              </span>
            </PinPopover>
          </>
        )}
      </div>

      {!model || !chain || !ctx ? (
        <div className="text-[11px] text-ink-muted/75">
          {model && model.chains.length === 0 ? "no polymer chain found in the model" : "sequence lanes: load a model"}
        </div>
      ) : (
        <div
          ref={viewerRef}
          className="select-none overflow-x-auto overscroll-x-contain"
          style={{ touchAction: "pan-x pan-y" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        >
          <div className="relative" style={boardStyle}>
            <Row label="" height={RULER_H} trackRef={setLaneNode} plain>
              <div className="absolute inset-x-0 bottom-0 border-b border-line-strong" />
              {ticks.map((t) => (
                <span
                  key={t.pos}
                  className="absolute bottom-0 -translate-x-1/2 font-mono text-[9px] tabular-nums text-ink-muted"
                  style={{ left: `${((t.pos - 0.5) / length) * 100}%` }}
                >
                  {t.label && <span className="absolute bottom-[5px] -translate-x-1/2">{t.label}</span>}
                  <span className="block bg-line-strong" style={{ width: 1, height: t.label ? 4 : 2.5 }} />
                </span>
              ))}
            </Row>
            {lanes.map((m) => (
              <Row key={m.id} label={m.label} height={m.height}>
                <m.Component ctx={ctx} view={view} onSelectSpan={selectSpan} />
              </Row>
            ))}
            {(dragSpan ?? selectionSpan) && <Column span={(dragSpan ?? selectionSpan)!} length={length} color={COLOR_SELECTION} />}
            {hoverPos !== null && <Column span={{ start: hoverPos, end: hoverPos }} length={length} color={COLOR_HOVER} />}
          </div>
        </div>
      )}

      <div className="min-h-[1rem] text-[10.5px] tabular-nums text-ink-muted">
        {readout ??
          (chain
            ? `chain ${chain.chain}: ${chain.length} residues${chain.source === "atom_site" ? " (observed residues; no sequence record in the source file)" : ""} — click a residue to select, drag for a range, click a feature for its span; pinch or +/- to zoom`
            : "")}
      </div>
    </div>
  );
}
