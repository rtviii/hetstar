"use client";
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// The box the fixed cards (PinPopover, HoverFlyout) stay inside. A host that embeds the
// viewer in a clipped or isolated frame keeps anything drawn past that frame's edge
// hidden behind its own page chrome, so the cards place and cap themselves by the room
// inside this element rather than the viewport. Unset, the viewport is the box.
export const CardBoundsContext = createContext<RefObject<HTMLElement | null> | null>(null);

// Shared UI vocabulary for the viewer, in the Harbor Mono look (tailwind.config.ts,
// styles.css hs-*): labels, controls and badges in Plex Mono capitals; names and prose in
// Plex Sans; values in Plex Mono. 2 px corners, no shadow but the floating card's, and one
// box deep: inside a card a section is its title stripe and its content. Purple only on the
// stripe's tick, pressed state, links, focus and progress. No component library.

/** a label: a field's name, a column head, a section name inside a flyout */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="hs-label block">{children}</span>;
}

/** the flyout/popup section heading (one shared definition; was copied per panel) */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <span className="hs-label">{children}</span>;
}

// The one card shell for every floating surface (tooltip, popover, flyout, popup, dock
// box): a white sheet, one hairline, the viewer's only shadow (styles.css .hs-card).
export const CARD_SHELL = "hs-card";

export function TinyText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`text-[10px] leading-snug text-ink-muted ${className ?? ""}`}>{children}</div>;
}

/** a number with its unit a step back: "1.80 Å", "293 K", "306 residues" */
export function Num({ children, unit }: { children: ReactNode; unit?: string }) {
  return (
    <span className="hs-value">
      {children}
      {unit && <span className="hs-unit"> {unit}</span>}
    </span>
  );
}

function readFlag(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string | undefined, value: boolean) {
  if (!key) return;
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* no storage: the flag lives for the session */
  }
}

/** an on/off flag kept in localStorage under `key` (read after mount, so SSR matches) */
export function useStoredFlag(key: string | undefined, fallback: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(fallback);
  useEffect(() => setValue(readFlag(key, fallback)), [key, fallback]);
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      writeFlag(key, next);
    },
    [key],
  );
  return [value, set];
}

// A section of a panel: its title stripe, which folds it, and its content. No box of its
// own (one box deep). Folded, the stripe can carry a one-line summary of what is inside,
// so the reader opens only what they need. `storageKey` keeps the fold across visits.
export function Section({
  title,
  count,
  summary,
  defaultOpen = true,
  storageKey,
  flush,
  children,
}: {
  title: string;
  /** a count beside the title (models, ligands) */
  count?: number;
  /** shown at the stripe's right end while folded */
  summary?: ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  /** no padding around the content (a table that runs edge to edge) */
  flush?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useStoredFlag(storageKey, defaultOpen);
  return (
    <section className="flex min-w-0 flex-col">
      <button type="button" className="hs-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="hs-chevron" aria-hidden />
        <span className="hs-head-title">{title}</span>
        {count != null && <span className="hs-value text-[9.5px] text-ink-muted">{count}</span>}
        {!open && summary && <span className="ml-auto min-w-0 truncate text-[10px] text-ink-muted">{summary}</span>}
      </button>
      {open && <div className={flush ? "min-w-0" : "min-w-0 px-2.5 py-2"}>{children}</div>}
    </section>
  );
}

// Explanatory prose behind a "?" toggle: there for the reader who wants the definition,
// out of the way of the one who knows it.
export function Help({ children, label = "what is this" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="hs-btn hs-btn-sm hs-btn-icon"
        aria-pressed={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open && <TinyText className="basis-full">{children}</TinyText>}
    </>
  );
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
      className="hs-btn hs-btn-icon"
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
          className={`pointer-events-none fixed z-50 w-72 p-2 font-sans text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-secondary ${CARD_SHELL}`}
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
type CardBox = { left: number; right: number; top: number; bottom: number; height: number };
type CardAnchor = { x: number; top: number; bottom: number; box: CardBox };
const CARD_EDGE = 8; // min distance to the box edge
const CARD_GAP = 6; // anchor-to-card gap
const CARD_MAX_FRACTION = 0.75; // of the box height

function cardBox(bounds: RefObject<HTMLElement | null> | null): CardBox {
  const rect = bounds?.current?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) return rect;
  return { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight, height: window.innerHeight };
}

function cardAnchor(
  el: HTMLElement | null,
  width: number,
  align: "start" | "end",
  bounds: RefObject<HTMLElement | null> | null,
): CardAnchor | null {
  const rect = el?.getBoundingClientRect();
  if (!rect) return null;
  const box = cardBox(bounds);
  const left = align === "end" ? rect.right - width : rect.left;
  const x = Math.max(box.left + CARD_EDGE, Math.min(left, box.right - width - CARD_EDGE));
  return { x, top: rect.top, bottom: rect.bottom, box };
}

function sameAnchor(a: CardAnchor | null, b: CardAnchor | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.top === b.top && a.bottom === b.bottom && a.box.top === b.box.top && a.box.bottom === b.box.bottom;
}

// While a card is open its anchor can move: the page scrolls, the window resizes, or the
// layout around it changes (a lane enabled grows the strip the trigger sits in). The card
// is position:fixed, so it has to be re-placed; one rect read per frame while open.
function useFollowAnchor(open: boolean, measure: () => CardAnchor | null, setPos: (pos: CardAnchor | null) => void) {
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let last: CardAnchor | null = null;
    const tick = () => {
      const next = measure();
      if (next && !sameAnchor(next, last)) {
        last = next;
        setPos(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, measure, setPos]);
}

function useCardPlacement(anchor: CardAnchor | null, width: number) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState(0);
  useLayoutEffect(() => {
    if (anchor && cardRef.current) setContentH(cardRef.current.scrollHeight);
  }, [anchor]);

  if (!anchor) return { cardRef, style: undefined };
  const roomBelow = anchor.box.bottom - anchor.bottom - CARD_GAP - CARD_EDGE;
  const roomAbove = anchor.top - anchor.box.top - CARD_GAP - CARD_EDGE;
  const above = contentH > roomBelow && roomAbove > roomBelow;
  const style: CSSProperties = {
    left: anchor.x,
    width,
    maxHeight: Math.max(0, Math.min(above ? roomAbove : roomBelow, anchor.box.height * CARD_MAX_FRACTION)),
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
  const bounds = useContext(CardBoundsContext);
  const [pos, setPos] = useState<CardAnchor | null>(null);
  const { cardRef, style } = useCardPlacement(pos, width);

  const measure = useCallback(() => cardAnchor(anchorRef.current, width, align, bounds), [width, align, bounds]);
  const toggle = useCallback(() => {
    setPos((prev) => (prev ? null : measure()));
  }, [measure]);

  const close = useCallback(() => setPos(null), []);
  useDismiss(rootRef, pos !== null, close);
  useFollowAnchor(pos !== null, measure, setPos);

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
          className={`fixed z-50 cursor-auto select-text overflow-y-auto p-2 font-sans text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-secondary ${CARD_SHELL}`}
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
  const bounds = useContext(CardBoundsContext);
  const [pos, setPos] = useState<CardAnchor | null>(null);
  const { cardRef, style } = useCardPlacement(pos, width);

  const measure = useCallback(() => cardAnchor(anchorRef.current, width, align, bounds), [align, width, bounds]);
  useFollowAnchor(pos !== null, measure, setPos);

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
          className={`fixed z-50 cursor-auto select-text overflow-y-auto p-2 font-sans text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-secondary ${CARD_SHELL}`}
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
  value,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  /** the button shows a value (a state id, an altloc letter), which keeps its own case */
  value?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`hs-btn ${value ? "normal-case tracking-normal text-[10px]" : ""}`}
    >
      {children}
    </button>
  );
}

/** buttons joined into one control: a choice among a few (representation, quality, zoom) */
export function Segmented({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <span className="hs-seg" role="group" aria-label={label}>
      {children}
    </span>
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
      <span className="hs-label">{label}</span>
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
        <span className="hs-value whitespace-nowrap text-right text-[10px] text-ink-secondary">{display}</span>
      )}
    </label>
  );
}
