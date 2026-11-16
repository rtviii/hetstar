"use client";
import { useEffect, useRef } from "react";
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import { useMolstarViewer } from "../hooks/useMolstarViewer";
import type { MolstarViewer as MolstarViewerInstance } from "../lib/molstar/viewer";
import type { StructureView } from "../lib/molstar/style";

// React boundary around the pure MolstarViewer wrapper: renders the container,
// manages lifecycle via the hook, and (re)loads whenever `data` (or the requested view) changes.
// New data under the same `sceneKey` replaces the primary model alone and keeps the camera;
// a new scene clears the whole tree.
export default function MolstarViewer({
  data,
  sceneKey = null,
  schedule,
  binary,
  view,
  bare,
  onReady,
  onLoaded,
  colorThemes,
}: {
  data: string | Uint8Array | null;
  /** what the scene belongs to (an entry): the density and the other models outlive a data
   * change while it stays the same */
  sceneKey?: string | null;
  /** runs a load for the host: one that serializes its own writes to the Mol* tree passes
   * its queue here, so a load never overlaps them */
  schedule?: (load: () => Promise<void>) => void;
  binary: boolean;
  view?: StructureView;
  /** load the structure with nothing drawn: the host builds what is drawn, in its own look,
   * and frames the camera once that shows (a fresh scene has nothing to frame before) */
  bare?: boolean;
  onReady?: (viewer: MolstarViewerInstance | null) => void;
  /** freshScene: the tree was cleared for this load, so the camera is not placed yet */
  onLoaded?: (info: { modelCount: number; freshScene: boolean }) => void;
  /** the preset's Mol* colour themes, registered at plugin init */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colorThemes?: readonly ColorTheme.Provider<any, any>[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewer, ready } = useMolstarViewer(containerRef, colorThemes);

  // Keep latest onLoaded without making it a load-effect dependency (it changes identity each render).
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

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

  // loads run one after another: two overlapping ones would each build a primary
  const loadChainRef = useRef<Promise<void>>(Promise.resolve());
  const loadedSceneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!viewer || !ready || data == null) return;
    let cancelled = false;
    const load = async () => {
      if (cancelled) return;
      try {
        const sameScene =
          sceneKey !== null && loadedSceneRef.current === sceneKey && viewer.getPrimaryStructureRef() !== null;
        if (sameScene) {
          await viewer.replacePrimary(data, { label: "structure", view, bare });
        } else {
          loadedSceneRef.current = null;
          await viewer.clear();
          if (cancelled) return;
          await viewer.load(data, { label: "structure", view, bare });
          if (!bare) viewer.resetCamera();
        }
        loadedSceneRef.current = sceneKey;
        if (cancelled) return;
        onLoadedRef.current?.({ modelCount: viewer.getModelCount(), freshScene: !sameScene });
      } catch (e) {
        console.error("Mol* failed to load structure:", e);
      }
    };
    if (scheduleRef.current) scheduleRef.current(load);
    else loadChainRef.current = loadChainRef.current.then(load);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, ready, data, sceneKey, binary, viewKey, bare]);

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
