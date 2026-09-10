"use client";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

// Shared UI vocabulary for the compare lab: small, compact, austere. Whites and the Dynamic
// PDB grays; the purple accent only on pressed state, links, focus and progress. No
// component library.

export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted">{children}</span>;
}

export function TinyText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`text-[10.5px] leading-snug text-ink-muted/75 ${className ?? ""}`}>{children}</div>;
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
          className="pointer-events-none fixed z-50 w-72 rounded border border-line bg-white p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-secondary shadow-md"
          style={{ left: pos.x, top: pos.above ? undefined : pos.y, bottom: pos.above ? window.innerHeight - pos.y : undefined }}
        >
          {content}
        </div>
      )}
    </span>
  );
}

// Click-to-pin popover for content the user needs to READ and USE (select, copy, follow
// links) — unlike Tooltip, whose card is pointer-events-none. Opens on trigger click,
// closes on Escape, outside mousedown, clicking the trigger again, or when `closeKey`
// changes (say, a new entry resolved). The card is position:fixed (measured on open) so it
// escapes the overflow-y-auto side columns; `align: "end"` hangs it leftward from the
// trigger's right edge, for triggers near the viewport's right side.
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
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const toggle = useCallback(() => {
    setPos((prev) => {
      if (prev) return null;
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const left = align === "end" ? rect.right - width : rect.left;
      const x = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const above = rect.bottom + 280 > window.innerHeight;
      return { x, y: above ? rect.top - 6 : rect.bottom + 6, above };
    });
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
          className="fixed z-50 max-h-[70vh] cursor-auto select-text overflow-y-auto rounded border border-line bg-white p-2.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-secondary shadow-md"
          style={{
            left: pos.x,
            width,
            top: pos.above ? undefined : pos.y,
            bottom: pos.above ? window.innerHeight - pos.y : undefined,
          }}
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
      className={`rounded border px-1.5 py-0.5 text-[11px] leading-tight transition-colors disabled:cursor-default disabled:opacity-40 ${
        pressed
          ? "border-accent bg-accent-soft text-accent"
          : "border-line-strong bg-white text-ink-secondary hover:bg-line"
      }`}
    >
      {children}
    </button>
  );
}

export function SliderRow({
  label,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
}: {
  label: ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-secondary">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
