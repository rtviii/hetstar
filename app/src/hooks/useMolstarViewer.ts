"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import { MolstarViewer } from "@/lib/molstar/viewer";

// Owns a single MolstarViewer bound to a container ref. Disposal is deferred so a
// React StrictMode unmount/remount (dev double-invoke) reuses the same plugin
// instead of tearing it down and rebuilding it. Mirrors the deferred-dispose
// approach in fend_tubulinxyz's MolstarInstanceManager, scoped to one instance.
export function useMolstarViewer(
  containerRef: RefObject<HTMLDivElement | null>,
  opts: { minimal?: boolean } = {},
) {
  const viewerRef = useRef<MolstarViewer | null>(null);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const minimal = opts.minimal;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // a pending dispose from a StrictMode unmount — cancel it and reuse the viewer
    if (disposeTimer.current) {
      clearTimeout(disposeTimer.current);
      disposeTimer.current = null;
    }

    const viewer = viewerRef.current ?? (viewerRef.current = new MolstarViewer());
    let cancelled = false;
    viewer.init(container, { minimal }).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
      disposeTimer.current = setTimeout(() => {
        viewer.dispose();
        viewerRef.current = null;
        disposeTimer.current = null;
        setReady(false);
      }, 1000);
    };
  }, [containerRef, minimal]);

  return { viewer: viewerRef.current, ready };
}
