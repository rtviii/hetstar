"use client";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from "react";

import { hexCss } from "../../lib/lab/color";
import { CARD_SHELL, PrismMark, type TipContent, Tooltip, useStoredFlag } from "../compare/ui";
import type { ColorSourceGroup, ColorSourceId, ColorSourceRow, ColorTarget } from "./board";

// The colour board: one card for every colour choice in the viewer. Sources run down the
// side, grouped by concept; targets run across the top; a cell is marked where the target
// shows the source, and a click on a cell switches that target alone. The "all" column
// switches every target that can show the row. The card stays where it is put (drag its
// title stripe) until it is closed.

const FOLD = "hetstar.color.fold.";
const DEFAULT_TOP = 34;
const EDGE = 8;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function TargetCell({ target, row, focused }: { target: ColorTarget; row: ColorSourceRow; focused: boolean }) {
  const cell = target.cell(row.id);
  const shown = target.current === row.id;
  if (!cell) return <td data-focus={focused} />;
  if (cell.state === "unavailable") {
    return (
      <td data-focus={focused} title={`${target.title}: ${row.label} is not available (${cell.reason})`}>
        <span className="hs-cell" data-stale={shown}>
          {shown ? <span className="hs-cell-mark" /> : <span className="hs-cell-off" />}
        </span>
      </td>
    );
  }
  if (cell.state === "request" && cell.status === "computing") {
    return (
      <td data-focus={focused}>
        <span className="hs-cell">
          <PrismMark size={10} label={`computing ${row.label} of ${target.title}`} />
        </span>
      </td>
    );
  }
  const request = cell.state === "request";
  return (
    <td data-focus={focused}>
      <button
        type="button"
        className="hs-cell"
        aria-pressed={shown}
        data-request={request}
        title={`${target.title}: ${row.label}${request ? " (computed on choosing; takes seconds)" : ""}`}
        onClick={() => target.choose(row.id)}
      >
        <span className="hs-cell-mark" />
      </button>
    </td>
  );
}

function AllCell({ targets, row }: { targets: readonly ColorTarget[]; row: ColorSourceRow }) {
  const able = targets.filter((target) => target.cell(row.id)?.state === "available");
  if (!able.length) return <td className="hs-matrix-first" />;
  const everywhere = able.every((target) => target.current === row.id);
  return (
    <td className="hs-matrix-first">
      <button
        type="button"
        className="hs-cell"
        aria-pressed={everywhere}
        title={`${row.label} on every target that can show it (${able.length})`}
        onClick={() => able.forEach((target) => target.choose(row.id))}
      >
        <span className="hs-cell-mark" />
      </button>
    </td>
  );
}

function GroupRows({
  group,
  targets,
  focus,
  tipFor,
  rowExtra,
}: {
  group: ColorSourceGroup;
  targets: readonly ColorTarget[];
  focus: string | null;
  tipFor: (source: ColorSourceId) => TipContent | null;
  rowExtra?: (source: ColorSourceId) => ReactNode;
}) {
  const [open, setOpen] = useStoredFlag(`${FOLD}${group.id}`, true);
  const inGroup = (source: ColorSourceId) => group.rows.some((row) => row.id === source);
  return (
    <tbody>
      <tr className="hs-matrix-group">
        <th scope="rowgroup">
          <button type="button" className="flex w-full items-center gap-1.5 pl-2.5 pr-1.5" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="hs-chevron" aria-hidden />
            <span className="hs-label text-ink-secondary">{group.title}</span>
          </button>
        </th>
        <td className="hs-matrix-first" />
        {targets.map((target) => (
          <td key={target.id}>
            {!open && inGroup(target.current) && (
              <span className="hs-cell" aria-pressed="true" title={`${target.title} shows a source of this group`}>
                <span className="hs-cell-mark" />
              </span>
            )}
          </td>
        ))}
        <td />
      </tr>
      {open &&
        group.rows.map((row) => {
          const tip = tipFor(row.id);
          const name = (
            <span className="flex items-center gap-1.5">
              {row.ramp && (
                <span
                  className="hs-matrix-ramp"
                  style={{ background: `linear-gradient(to right, ${row.ramp.map(hexCss).join(", ")})` }}
                />
              )}
              {row.label}
            </span>
          );
          return (
            <tr key={row.id}>
              <th scope="row" className="hs-matrix-name">
                {tip ? <Tooltip content={tip}>{name}</Tooltip> : name}
              </th>
              <AllCell targets={targets} row={row} />
              {targets.map((target) => (
                <TargetCell key={target.id} target={target} row={row} focused={target.id === focus} />
              ))}
              <td className="pl-1.5 pr-2">{rowExtra?.(row.id)}</td>
            </tr>
          );
        })}
    </tbody>
  );
}

export default function ColorBoard({
  targets,
  groups,
  focus,
  onClose,
  tipFor,
  rowExtra,
  note,
  footer,
}: {
  targets: readonly ColorTarget[];
  groups: readonly ColorSourceGroup[];
  /** the target whose button opened the board; its column is marked */
  focus: string | null;
  onClose: () => void;
  /** the explanation of a source, shown on its row's name */
  tipFor: (source: ColorSourceId) => TipContent | null;
  /** controls at a row's end (recompute and erase of an on-request metric, a look's options) */
  rowExtra?: (source: ColorSourceId) => ReactNode;
  /** beside the title: what the comparisons are made against */
  note?: ReactNode;
  footer?: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  const startDrag = (event: ReactPointerEvent) => {
    if ((event.target as Element).closest("button")) return;
    const card = cardRef.current;
    const parent = card?.offsetParent;
    if (!card || !parent) return;
    event.preventDefault();
    const cardRect = card.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const grabX = event.clientX - cardRect.left;
    const grabY = event.clientY - cardRect.top;
    const onMove = (move: PointerEvent) => {
      setPlace({
        left: clamp(move.clientX - parentRect.left - grabX, 0, parentRect.width - cardRect.width),
        top: clamp(move.clientY - parentRect.top - grabY, 0, parentRect.height - 24),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // column groups: runs of targets that stand under the same heading
  const spans: { title: string; count: number }[] = [];
  for (const target of targets) {
    const last = spans[spans.length - 1];
    if (last && last.title === target.group) last.count += 1;
    else spans.push({ title: target.group, count: 1 });
  }

  const top = place?.top ?? DEFAULT_TOP;
  return (
    <div
      ref={cardRef}
      data-hetstar-part="color-board"
      className={`absolute z-20 flex max-w-[calc(100%-16px)] flex-col overflow-hidden text-[10.5px] text-ink-secondary ${CARD_SHELL}`}
      style={{
        top,
        left: place?.left,
        right: place ? undefined : EDGE,
        maxHeight: `calc(100% - ${top + EDGE}px)`,
      }}
    >
      <div className="hs-head cursor-move select-none" onPointerDown={startDrag} title="drag to move the board">
        <span className="hs-head-title">Color</span>
        {note}
        <button
          type="button"
          className="hs-btn hs-btn-sm hs-btn-icon hs-btn-quiet ml-auto"
          title="close the colour board"
          aria-label="close the colour board"
          onClick={onClose}
        >
          {"×"}
        </button>
      </div>
      <div className="min-h-0 overflow-auto">
        <table className="hs-matrix">
          <thead>
            <tr>
              <th />
              <th className="hs-matrix-first" />
              {spans.map((span, index) => (
                <th key={index} colSpan={span.count} className="hs-matrix-span">
                  {/* w-0 + min-w-full: a long name is cut to the columns it spans instead of widening them */}
                  <span className="hs-label block w-0 min-w-full truncate text-[8px]" title={span.title}>
                    {span.title}
                  </span>
                </th>
              ))}
              <th />
            </tr>
            <tr>
              <th />
              <th className="hs-matrix-col hs-matrix-first" title="every target that can show the row">
                <span>all</span>
              </th>
              {targets.map((target) => (
                <th key={target.id} className="hs-matrix-col" data-focus={target.id === focus} title={target.title}>
                  {target.swatch !== null && <i className="hs-pip mx-auto mb-0.5 block" style={{ background: hexCss(target.swatch) }} />}
                  <span className="w-0 min-w-full">{target.label}</span>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          {groups.map((group) => (
            <GroupRows key={group.id} group={group} targets={targets} focus={focus} tipFor={tipFor} rowExtra={rowExtra} />
          ))}
        </table>
      </div>
      {footer && <div className="shrink-0 border-t border-line px-2.5 py-1">{footer}</div>}
    </div>
  );
}
