"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import { ReplicaViewer } from "../lib/molstar/replica";

/** One ReplicaViewer per mounted box; null until its plugin is up. Same lifecycle as useMolstarViewer. */
export function useReplicaViewer(
  containerRef: RefObject<HTMLDivElement | null>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colorThemes: readonly ColorTheme.Provider<any, any>[] = [],
): { viewer: ReplicaViewer | null; error: string | null } {
  const viewerRef = useRef<ReplicaViewer | null>(null);
  const themesRef = useRef(colorThemes);
  themesRef.current = colorThemes;
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // a pending dispose from a StrictMode unmount: cancel it and reuse the viewer
    if (disposeTimer.current) {
      clearTimeout(disposeTimer.current);
      disposeTimer.current = null;
    }

    const viewer = viewerRef.current ?? (viewerRef.current = new ReplicaViewer());
    let cancelled = false;
    viewer.init(container, themesRef.current).then(
      () => {
        if (!cancelled) setReady(true);
      },
      (e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );

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

  return { viewer: ready ? viewerRef.current : null, error };
}
