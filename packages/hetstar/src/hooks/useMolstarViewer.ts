"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import { MolstarViewer } from "../lib/molstar/viewer";

export function useMolstarViewer(containerRef: RefObject<HTMLDivElement | null>) {
  const viewerRef = useRef<MolstarViewer | null>(null);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);

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
    viewer.init(container).then(() => {
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
  }, [containerRef]);

  return { viewer: viewerRef.current, ready };
}
