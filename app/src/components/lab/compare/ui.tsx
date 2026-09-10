"use client";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

// Shared UI vocabulary for the compare lab: small, compact, austere. Whites and grays,
// sky/navy accents only on active state, no component library.

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{children}</div>;
}

export function TinyText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`text-[10.5px] leading-snug text-neutral-400 ${className ?? ""}`}>{children}</div>;
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
          className="pointer-events-none fixed z-50 w-72 rounded border border-neutral-200 bg-white p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-neutral-600 shadow-md"
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
// closes on Escape, outside mousedown, or clicking the trigger again. The card is
// position:fixed (measured on open) so it escapes the overflow-y-auto side columns.
export function PinPopover({
  content,
  children,
  width = 384,
}: {
  content: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const toggle = useCallback(() => {
    setPos((prev) => {
      if (prev) return null;
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const x = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const above = rect.bottom + 280 > window.innerHeight;
      return { x, y: above ? rect.top - 6 : rect.bottom + 6, above };
    });
  }, [width]);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (cardRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setPos(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [pos]);

  return (
    <span className="inline-flex">
      <span ref={anchorRef} className="inline-flex cursor-pointer" onClick={toggle}>
        {children}
      </span>
      {pos && (
        <div
          ref={cardRef}
          className="fixed z-50 max-h-[70vh] cursor-auto select-text overflow-y-auto rounded border border-neutral-200 bg-white p-2.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-neutral-600 shadow-md"
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
  onClick,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`rounded border px-1.5 py-0.5 text-[11px] leading-tight transition-colors disabled:cursor-default disabled:opacity-40 ${
        pressed
          ? "border-sky-700 bg-sky-50 text-sky-900"
          : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
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
      <span className="text-[11px] text-neutral-600">{label}</span>
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
