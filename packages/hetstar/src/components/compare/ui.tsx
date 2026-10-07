"use client";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// Shared UI vocabulary for the viewer: small, compact, austere. Whites and the Dynamic
// PDB grays; the purple accent only on pressed state, links, focus and progress. No
// component library.

export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="block text-[11px] font-medium uppercase tracking-wider text-ink-muted">{children}</span>;
}

/** the flyout/popup section heading (one shared definition; was copied per panel) */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <span className="text-[10px] font-medium uppercase tracking-wider text-ink-muted/80">{children}</span>;
}

// The one card shell for every ephemeral surface (tooltip, popover, flyout, popup):
// translucent white over a backdrop blur, soft border, small shadow — the tubulinxyz
// treatment on the DPDB grays.
export const CARD_SHELL =
  "rounded-lg border border-line-strong/60 bg-white/85 backdrop-blur-sm shadow-sm";

export function TinyText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`text-[10.5px] leading-snug text-ink-muted/75 ${className ?? ""}`}>{children}</div>;
}

/** The one loading spinner (entry chip, viewer overlay). Size via className (default 12px). */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-line border-t-accent ${className ?? "h-3 w-3"}`}
      aria-label="loading"
    />
  );
}

/** Compact square icon button for the actions popup (no pressed state — see SwitchButton). */
export function IconButton({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  /** aria-label; the explanation belongs in a wrapping Tooltip */
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded border border-line-strong bg-white/70 text-ink-secondary transition-colors hover:bg-line/70 disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// Escape and a capture-phase mousedown outside `ref` close a floating card; the listeners
// exist only while it is open. Pass a stable `onClose` (useCallback) so the effect does not
// re-subscribe on every render.
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [ref, open, onClose]);
}

// Hover tooltip, hand-rolled: the card is position:fixed (measured once on open) so it
// escapes the overflow-y-auto side columns. ~250 ms open delay, closes on leave.
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const open = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 288; // w-72
      const x = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const above = rect.bottom + 140 > window.innerHeight;
      setPos({ x, y: above ? rect.top - 6 : rect.bottom + 6, above });
    }, 250);
  }, []);

  const close = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setPos(null);
  }, []);

  useEffect(() => close, [close]);

  return (
    <span ref={anchorRef} className="inline-flex" onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}>
      {children}
      {pos && (
        <div
          className={`pointer-events-none fixed z-50 w-72 p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-secondary ${CARD_SHELL}`}
          style={{ left: pos.x, top: pos.above ? undefined : pos.y, bottom: pos.above ? window.innerHeight - pos.y : undefined }}
        >
          {content}
        </div>
      )}
    </span>
  );
}

// Placement shared by PinPopover and HoverFlyout. The card hangs below its anchor when its
// content fits there, else on the side with more room, and is capped to that room so a
// long card scrolls inside itself instead of running off the viewport (a fixed card can't
// be reached by scrolling the page). The content height is measured in a layout effect,
// i.e. before paint, so the card never shows on the wrong side.
type CardAnchor = { x: number; top: number; bottom: number };
const CARD_EDGE = 8; // min distance to the viewport edge
const CARD_GAP = 6; // anchor-to-card gap
const CARD_MAX_VH = 0.75;

function cardAnchor(el: HTMLElement | null, width: number, align: "start" | "end"): CardAnchor | null {
  const rect = el?.getBoundingClientRect();
  if (!rect) return null;
  const left = align === "end" ? rect.right - width : rect.left;
  const x = Math.max(CARD_EDGE, Math.min(left, window.innerWidth - width - CARD_EDGE));
  return { x, top: rect.top, bottom: rect.bottom };
}

function useCardPlacement(anchor: CardAnchor | null, width: number) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState(0);
  useLayoutEffect(() => {
    if (anchor && cardRef.current) setContentH(cardRef.current.scrollHeight);
  }, [anchor]);

  if (!anchor) return { cardRef, style: undefined };
  const roomBelow = window.innerHeight - anchor.bottom - CARD_GAP - CARD_EDGE;
  const roomAbove = anchor.top - CARD_GAP - CARD_EDGE;
  const above = contentH > roomBelow && roomAbove > roomBelow;
  const style: CSSProperties = {
    left: anchor.x,
    width,
    maxHeight: Math.max(0, Math.min(above ? roomAbove : roomBelow, window.innerHeight * CARD_MAX_VH)),
    top: above ? undefined : anchor.bottom + CARD_GAP,
    bottom: above ? window.innerHeight - anchor.top + CARD_GAP : undefined,
  };
  return { cardRef, style };
}

// Click-to-pin popover for content the user needs to READ and USE (select, copy, follow
// links) — unlike Tooltip, whose card is pointer-events-none. Opens on trigger click,
// closes on Escape, outside mousedown, clicking the trigger again, or when `closeKey`
// changes (say, a new entry resolved). The card is position:fixed (placed on open, see
// useCardPlacement) so it escapes the overflow-y-auto side columns; `align: "end"` hangs
// it leftward from the trigger's right edge, for triggers near the viewport's right side.
export function PinPopover({
  content,
  children,
  width = 384,
  align = "start",
  closeKey,
}: {
  content: ReactNode;
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
  closeKey?: unknown;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<CardAnchor | null>(null);
  const { cardRef, style } = useCardPlacement(pos, width);

  const toggle = useCallback(() => {
    setPos((prev) => (prev ? null : cardAnchor(anchorRef.current, width, align)));
  }, [width, align]);

  const close = useCallback(() => setPos(null), []);
  useDismiss(rootRef, pos !== null, close);

  // close on a key change, not on mount
  const keySeenRef = useRef(false);
  useEffect(() => {
    if (!keySeenRef.current) {
      keySeenRef.current = true;
      return;
    }
    setPos(null);
  }, [closeKey]);

  return (
    <span ref={rootRef} className="inline-flex">
      <span ref={anchorRef} className="inline-flex cursor-pointer" onClick={toggle}>
        {children}
      </span>
      {pos && (
        <div
          ref={cardRef}
          className={`fixed z-50 cursor-auto select-text overflow-y-auto p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-secondary ${CARD_SHELL}`}
          style={style}
        >
          {content}
        </div>
      )}
    </span>
  );
}

// Hover-open flyout for the icon tray: interactive content (unlike Tooltip, whose card
// is pointer-events-none), fixed-positioned like PinPopover so it escapes the overflow
// columns. Opens after a short hover delay, stays while the pointer is over the anchor
// or the card (enter/leave ride the DOM hierarchy, so the fixed card still counts as
// inside; one shared grace timer bridges the spatial gap between them). pinOnClick lets
// the anchor click pin it open for anchors with no click action of their own; anchors
// WITH a click action (the density toggle) keep it — the anchor's onClick is never
// intercepted. Escape and outside-mousedown always close.
export function HoverFlyout({
  content,
  children,
  width = 288,
  align = "end",
  pinOnClick = false,
}: {
  content: ReactNode;
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
  pinOnClick?: boolean;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedRef = useRef(false);
  const [pos, setPos] = useState<CardAnchor | null>(null);
  const { cardRef, style } = useCardPlacement(pos, width);

  const measure = useCallback(() => cardAnchor(anchorRef.current, width, align), [align, width]);

  const cancelTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onEnter = useCallback(() => {
    cancelTimer();
    timerRef.current = setTimeout(() => setPos((prev) => prev ?? measure()), 200);
  }, [cancelTimer, measure]);

  const onLeave = useCallback(() => {
    cancelTimer();
    if (pinnedRef.current) return;
    timerRef.current = setTimeout(() => setPos(null), 250);
  }, [cancelTimer]);

  const onAnchorClick = useCallback(() => {
    if (!pinOnClick) return;
    if (pinnedRef.current) {
      pinnedRef.current = false;
      setPos(null);
    } else {
      pinnedRef.current = true;
      cancelTimer();
      setPos((prev) => prev ?? measure());
    }
  }, [pinOnClick, cancelTimer, measure]);

  const close = useCallback(() => {
    pinnedRef.current = false;
    setPos(null);
  }, []);
  useDismiss(rootRef, pos !== null, close);
  useEffect(() => cancelTimer, [cancelTimer]);

  return (
    <span ref={rootRef} className="inline-flex" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <span ref={anchorRef} className="inline-flex" onClick={onAnchorClick}>
        {children}
      </span>
      {pos && (
        <div
          ref={cardRef}
          className={`fixed z-50 cursor-auto select-text overflow-y-auto p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-secondary ${CARD_SHELL}`}
          style={style}
        >
          {content}
        </div>
      )}
    </span>
  );
}

export function SwitchButton({
  pressed,
  disabled,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded border px-1 py-px text-[10.5px] leading-tight transition-colors disabled:cursor-default disabled:opacity-40 ${
        pressed
          ? "border-accent bg-accent-soft text-accent"
          : "border-line-strong/70 bg-white/70 text-ink-secondary hover:bg-line/70"
      }`}
    >
      {children}
    </button>
  );
}

// One compact row: label left, range in the middle, optional value readout right.
export function SliderRow({
  label,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
  display,
}: {
  label: ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  /** formatted current value, rendered right of the range */
  display?: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="whitespace-nowrap text-[10px] text-ink-muted">{label}</span>
      <input
        type="range"
        className="min-w-0 flex-1"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {display != null && (
        <span className="whitespace-nowrap text-right text-[10px] tabular-nums text-ink-muted">{display}</span>
      )}
    </label>
  );
}
