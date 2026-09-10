"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import MolstarViewer from "@/components/MolstarViewer";
import type { MolstarViewer as ViewerInstance } from "@/lib/molstar/viewer";
import type { StructureView } from "@/lib/molstar/style";
import {
  buildIsosurfaces,
  loadStructureFactors,
  updateIsoSigma,
  type DensityReprs,
  type DensityVolumes,
} from "@/lib/molstar/density";
import { carveDensityToStructure } from "@/lib/molstar/carve";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";

// Density lab: the incremental prototyping ground. One density capability is added and
// verified at a time; features graduate out of here once they behave.
//
//   step 0 (this): model + maps carved around it. 2Fo-Fc with a live sigma contour,
//                  Fo-Fc difference map fixed at +/-3 sigma.
//   step 1: per-residue carve on click (density for one residue only).
//   step 2: slice plane with a position slider along its normal.
//   step 3: metric projection onto the carved surface.

const MODEL_URL = "/corpus/7a1x_qFit_010.cif";
const SF_URL = "https://files.rcsb.org/download/7A1X-sf.cif";
const VIEW: StructureView = { representation: "ball-and-stick", colorTheme: "alt-loc" };

export default function DensityLabPanel() {
  const [viewer, setViewer] = useState<ViewerInstance | null>(null);
  const [modelText, setModelText] = useState<string | null>(null);
  const [status, setStatus] = useState("loading model...");
  const [densityState, setDensityState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const [show2fofc, setShow2fofc] = useState(true);
  const [showFofc, setShowFofc] = useState(false);
  const [sigma, setSigma] = useState(1.5);

  const volsRef = useRef<DensityVolumes | null>(null);
  const reprsRef = useRef<DensityReprs | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(MODEL_URL);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const text = await res.text();
        if (cancelled) return;
        setModelText(text);
        setStatus("model loaded");
      } catch (e) {
        if (!cancelled) setStatus(`model load failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadDensity = useCallback(async () => {
    if (!viewer?.ctx || densityState === "loading" || densityState === "ready") return;
    setDensityState("loading");
    setStatus("fetching structure factors (RCSB, 5.6 MB)...");
    try {
      const res = await fetch(SF_URL);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      setStatus("FFT: map coefficients to 2Fo-Fc / Fo-Fc grids...");
      const vols = await loadStructureFactors(viewer.ctx, text, { entryId: "7A1X", label: "7A1X-sf" });
      if (!vols.twoFoFc && !vols.foFc) throw new Error("no map coefficients found in sf file");
      const structure = viewer.getCurrentStructure();
      if (!structure) throw new Error("no structure loaded to carve around");
      setStatus("carving the periodic maps around the model...");
      carveDensityToStructure(viewer.ctx, vols, structure);
      const reprs = await buildIsosurfaces(viewer.ctx, vols);
      volsRef.current = vols;
      reprsRef.current = reprs;
      setDensityState("ready");
      setStatus("density ready; it should hug the model");
    } catch (e) {
      setDensityState("error");
      setStatus(`density failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [viewer, densityState]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    const r = reprsRef.current;
    if (!ctx || !r?.twoFoFc) return;
    setSubtreeVisibility(ctx.state.data, r.twoFoFc, !show2fofc);
  }, [viewer, show2fofc, densityState]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    const r = reprsRef.current;
    if (!ctx) return;
    for (const ref of [r?.foFcPos, r?.foFcNeg]) {
      if (ref) setSubtreeVisibility(ctx.state.data, ref, !showFofc);
    }
  }, [viewer, showFofc, densityState]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    const ref = reprsRef.current?.twoFoFc;
    if (!ctx || !ref || densityState !== "ready") return;
    const t = setTimeout(() => void updateIsoSigma(ctx, ref, sigma), 80);
    return () => clearTimeout(t);
  }, [viewer, sigma, densityState]);

  const ready = densityState === "ready";

  return (
    <div className="flex h-screen min-h-0">
      <div className="relative min-w-0 flex-1">
        <MolstarViewer data={modelText} binary={false} view={VIEW} onReady={setViewer} />
      </div>
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-neutral-200 bg-neutral-50 p-3 text-[13px]">
        <div className="font-semibold">Density lab</div>
        <div className="text-neutral-500">{status}</div>

        <button
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-left hover:bg-neutral-100 disabled:opacity-40"
          onClick={() => void loadDensity()}
          disabled={!viewer || !modelText || densityState === "loading" || ready}
        >
          {ready ? "Density loaded" : densityState === "loading" ? "Loading..." : "Load density (7A1X)"}
        </button>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={show2fofc} disabled={!ready} onChange={(e) => setShow2fofc(e.target.checked)} />
          <span>2Fo-Fc (blue)</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-600">2Fo-Fc contour: {sigma.toFixed(1)} sigma</span>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.1}
            value={sigma}
            disabled={!ready || !show2fofc}
            onChange={(e) => setSigma(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showFofc} disabled={!ready} onChange={(e) => setShowFofc(e.target.checked)} />
          <span>Fo-Fc (+3 green / -3 red)</span>
        </label>

        <div className="mt-2 border-t border-neutral-200 pt-2 text-neutral-500">
          Step 0: maps are FFT&apos;d from the deposited structure factors and resampled
          (&quot;carved&quot;) onto a grid that follows the model, so contours sit on the atoms.
          Next steps: per-residue carve on click, movable slice, metric projection.
        </div>
      </div>
    </div>
  );
}
