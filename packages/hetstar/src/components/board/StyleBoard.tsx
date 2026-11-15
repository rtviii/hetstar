"use client";
import { Fragment, type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from "react";

import { hexCss } from "../../lib/lab/color";
import { EyeIcon, EyeOffIcon } from "../compare/icons";
import { CARD_SHELL, PrismMark, type TipContent, Tooltip, useStoredFlag } from "../compare/ui";
import type { BoardGroup, BoardRow, BoardRowId, BoardTarget } from "./board";

// The style board: one card for every choice of look in the viewer. Rows run down the side,
// shape first (what a model is drawn as, which parts show) and colour after, grouped by
// concept; targets run across the top; a cell is marked where the target shows the row, and
// a click on a cell switches that target alone. The "all" column switches every target that
// can show the row. The eye under a target's name shows or hides it and dims its column.
// The card stays where it is put (drag its title stripe, drag its right edge to size it)
// until the page is left.

const FOLD = "hetstar.color.fold.";
const DEFAULT_TOP = 34;
const EDGE = 8;
const DEFAULT_WIDTH = 880;
const MIN_WIDTH = 420;

/** where the card was last put and how wide, kept while the page lives */
let remembered: { place: { left: number; top: number } | null; width: number | null } = { place: null, width: null };

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function TargetCell({ target, row, focused }: { target: BoardTarget; row: BoardRow; focused: boolean }) {
  const cell = target.cell(row.id);
  const shown = target.shows(row.id);
  const off = target.visible === false;
  if (!cell) return <td data-focus={focused} data-off={off} />;
  if (cell.state === "unavailable") {
    return (
      <td data-focus={focused} data-off={off} title={`${target.title}: ${row.label} is not available (${cell.reason})`}>
        <span className="hs-cell" data-stale={shown}>
          {shown ? <span className="hs-cell-mark" /> : <span className="hs-cell-off" />}
        </span>
      </td>
    );
  }
  if (cell.state === "request" && cell.status === "computing") {
    return (
      <td data-focus={focused} data-off={off}>
        <span className="hs-cell">
          <PrismMark size={10} label={`computing ${row.label} of ${target.title}`} />
        </span>
      </td>
    );
  }
  const request = cell.state === "request";
  return (
    <td data-focus={focused} data-off={off}>
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

function AllCell({ targets, row }: { targets: readonly BoardTarget[]; row: BoardRow }) {
  const able = targets.filter((target) => target.cell(row.id)?.state === "available");
  if (!able.length) return <td className="hs-matrix-first" />;
  const everywhere = able.every((target) => target.shows(row.id));
  // a part that shows everywhere is switched off everywhere; anything else is switched on
  // wherever it is not showing yet
  const act = () => able.filter((target) => (row.toggle && everywhere) || !target.shows(row.id)).forEach((target) => target.choose(row.id));
  return (
    <td className="hs-matrix-first">
      <button
        type="button"
        className="hs-cell"
        aria-pressed={everywhere}
        title={`${row.label} on every target that can show it (${able.length})`}
        onClick={act}
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
  group: BoardGroup;
  targets: readonly BoardTarget[];
  focus: string | null;
  tipFor: (row: BoardRowId) => TipContent | null;
  rowExtra?: (row: BoardRowId) => ReactNode;
}) {
  const [open, setOpen] = useStoredFlag(`${FOLD}${group.id}`, true);
  return (
    <>
      <tr className="hs-matrix-group">
        <th scope="rowgroup">
          <button type="button" className="flex w-full items-center gap-1.5 pl-2.5 pr-1.5" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="hs-chevron" aria-hidden />
            <span className="hs-label text-ink-secondary">{group.title}</span>
          </button>
        </th>
        <td className="hs-matrix-first" />
        {targets.map((target) => (
          <td key={target.id} data-off={target.visible === false}>
            {!open && group.rows.some((row) => target.shows(row.id)) && (
              <span className="hs-cell" aria-pressed="true" title={`${target.title} shows a row of this group`}>
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
              <td className="hs-matrix-end">{rowExtra?.(row.id)}</td>
            </tr>
          );
        })}
    </>
  );
}

export default function StyleBoard({
  targets,
  groups,
  focus,
  onClose,
  tipFor,
  rowExtra,
  note,
  footer,
}: {
  targets: readonly BoardTarget[];
  groups: readonly BoardGroup[];
  /** the target whose button opened the board; its column is marked */
  focus: string | null;
  onClose: () => void;
  /** the explanation of a row, shown on its name */
  tipFor: (row: BoardRowId) => TipContent | null;
  /** controls at a row's end (a representation's scale, a look's options, a metric's range) */
  rowExtra?: (row: BoardRowId) => ReactNode;
  /** beside the title: what the comparisons are made against */
  note?: ReactNode;
  footer?: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [place, setPlaceState] = useState(remembered.place);
  const [width, setWidthState] = useState(remembered.width);
  const setPlace = (next: { left: number; top: number }) => {
    remembered = { ...remembered, place: next };
    setPlaceState(next);
  };
  const setWidth = (next: number) => {
    remembered = { ...remembered, width: next };
    setWidthState(next);
  };

  const track = (onMove: (move: PointerEvent) => void) => {
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

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
    track((move) =>
      setPlace({
        left: clamp(move.clientX - parentRect.left - grabX, 0, parentRect.width - cardRect.width),
        top: clamp(move.clientY - parentRect.top - grabY, 0, parentRect.height - 24),
      }),
    );
  };

  // the right edge is dragged, so the card is pinned by its left edge first
  const startResize = (event: ReactPointerEvent) => {
    const card = cardRef.current;
    const parent = card?.offsetParent;
    if (!card || !parent) return;
    event.preventDefault();
    const cardRect = card.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const left = cardRect.left - parentRect.left;
    setPlace({ left, top: cardRect.top - parentRect.top });
    track((move) => setWidth(clamp(move.clientX - cardRect.left, MIN_WIDTH, parentRect.width - left - EDGE)));
  };

  // column groups: runs of targets that stand under the same heading
  const spans: { title: string; count: number }[] = [];
  for (const target of targets) {
    const last = spans[spans.length - 1];
    if (last && last.title === target.group) last.count += 1;
    else spans.push({ title: target.group, count: 1 });
  }
  const share = `${Math.floor(88 / Math.max(1, targets.length))}%`;

  const top = place?.top ?? DEFAULT_TOP;
  return (
    <div
      ref={cardRef}
      data-hetstar-part="style-board"
      className={`absolute z-20 flex max-w-[calc(100%-16px)] flex-col overflow-hidden text-[10.5px] text-ink-secondary ${CARD_SHELL}`}
      style={{
        top,
        left: place?.left,
        right: place ? undefined : EDGE,
        width: width ?? DEFAULT_WIDTH,
        maxHeight: `calc(100% - ${top + EDGE}px)`,
      }}
    >
      <div className="hs-head cursor-move select-none" onPointerDown={startDrag} title="drag to move the board">
        <span className="hs-head-title">Style</span>
        {note}
        <button
          type="button"
          className="hs-btn hs-btn-sm hs-btn-icon hs-btn-quiet ml-auto"
          title="close the style board"
          aria-label="close the style board"
          onClick={onClose}
        >
          {"×"}
        </button>
      </div>
      <div className="min-h-0 overflow-auto">
        <table className="hs-matrix">
          <colgroup>
            <col className="hs-matrix-namecol" />
            <col className="hs-matrix-allcol" />
            {targets.map((target) => (
              <col key={target.id} style={{ width: share }} />
            ))}
            <col className="hs-matrix-endcol" />
          </colgroup>
          <thead>
            <tr>
              <th />
              <th className="hs-matrix-first" />
              {spans.map((span, index) => (
                <th key={index} colSpan={span.count} className="hs-matrix-span">
                  <span className="hs-label text-[8.5px]">{span.title}</span>
                </th>
              ))}
              <th />
            </tr>
            <tr>
              <th />
              <th className="hs-matrix-col hs-matrix-first" title="every target that can show the row">
                <span className="hs-matrix-label">all</span>
              </th>
              {targets.map((target) => (
                <th key={target.id} className="hs-matrix-col" data-focus={target.id === focus} data-off={target.visible === false}>
                  <Tooltip content={target.tip}>
                    <span className="flex flex-col items-center gap-0.5">
                      <span className="flex items-center gap-1">
                        {target.swatch !== null && <i className="hs-pip" style={{ background: hexCss(target.swatch) }} />}
                        {target.main && <span className="hs-tag hs-tag-accent">main</span>}
                      </span>
                      <span className="hs-matrix-label">{target.label}</span>
                    </span>
                  </Tooltip>
                </th>
              ))}
              <th />
            </tr>
            <tr className="hs-matrix-eyes">
              <th className="hs-matrix-name">
                <span className="hs-label text-[8.5px]">shown</span>
              </th>
              <th className="hs-matrix-first" />
              {targets.map((target) => (
                <th key={target.id} data-focus={target.id === focus}>
                  {target.visible !== null && (
                    <button
                      type="button"
                      className="hs-cell text-ink-secondary"
                      aria-pressed={target.visible}
                      title={`${target.visible ? "hide" : "show"} ${target.title}`}
                      aria-label={`${target.visible ? "hide" : "show"} ${target.title}`}
                      onClick={() => target.onVisible?.(!target.visible)}
                    >
                      {target.visible ? <EyeIcon /> : <EyeOffIcon />}
                    </button>
                  )}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((group, index) => (
              <Fragment key={group.id}>
                {group.section !== groups[index - 1]?.section && (
                  <tr className="hs-matrix-section">
                    <th colSpan={targets.length + 3}>
                      <span className="hs-label">{group.section}</span>
                    </th>
                  </tr>
                )}
                <GroupRows group={group} targets={targets} focus={focus} tipFor={tipFor} rowExtra={rowExtra} />
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="shrink-0 border-t border-line px-2.5 py-1">{footer}</div>}
      <div
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-accent/20"
        title="drag to change the board's width"
        onPointerDown={startResize}
      />
    </div>
  );
}
