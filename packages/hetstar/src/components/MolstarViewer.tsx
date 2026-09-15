"use client";
import { useEffect, useRef } from "react";
import { useMolstarViewer } from "../hooks/useMolstarViewer";
import type { MolstarViewer as MolstarViewerInstance } from "../lib/molstar/viewer";
import type { StructureView } from "../lib/molstar/style";

// React boundary around the pure MolstarViewer wrapper: renders the container,
// manages lifecycle via the hook, and (re)loads whenever `data` (or the requested view) changes.
export default function MolstarViewer({
  data,
  binary,
  view,
  onReady,
  onLoaded,
}: {
  data: string | Uint8Array | null;
  binary: boolean;
  view?: StructureView;
  onReady?: (viewer: MolstarViewerInstance | null) => void;
  onLoaded?: (info: { modelCount: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewer, ready } = useMolstarViewer(containerRef);

  // Keep latest onLoaded without making it a load-effect dependency (it changes identity each render).
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  // Surface the live viewer handle to the parent so the source view can drive
  // highlight/focus (cleared to null while not ready).
  useEffect(() => {
    onReady?.(ready ? viewer : null);
  }, [ready, viewer, onReady]);

  // The container's size is not always driven by a window resize: a flex/grid parent (or the host
  // page) can change it on its own. Mol* does not observe its canvas, so without this the scene
  // stays laid out for the old box.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !viewer || !ready) return;
    let raf: number | null = null;
    const ro = new ResizeObserver(() => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        viewer.handleResize();
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [viewer, ready]);

  // Key the load effect on prop CONTENT, not identity: call sites tend to pass inline
  // literals, and clear() wipes the whole Mol* state tree — a reload retriggered by a
  // mere re-render deletes unrelated state (e.g. density volumes) out from under whoever
  // built it.
  const viewKey = JSON.stringify(view ?? null);

  useEffect(() => {
    if (!viewer || !ready || data == null) return;
    let cancelled = false;
    (async () => {
      try {
        await viewer.clear();
        if (cancelled) return;
        await viewer.load(data, { label: "structure", view });
        if (cancelled) return;
        viewer.resetCamera();
        onLoadedRef.current?.({ modelCount: viewer.getModelCount() });
      } catch (e) {
        console.error("Mol* failed to load structure:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, ready, data, binary, viewKey]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-ink-muted">
          Initialising 3D viewer…
        </div>
      )}
    </div>
  );
}
