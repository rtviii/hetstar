"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildAtomTable,
  isHeavy,
  parseCifText,
  residueKey,
  type AtomTable,
} from "@dynamic-pdb/hetkit/model";
import { conformerCount, type Track } from "@dynamic-pdb/hetkit/metrics";

import MolstarViewer from "@/components/MolstarViewer";
import type { MolstarViewer as ViewerInstance, PickInfo } from "@/lib/molstar/viewer";
import type { StructureView } from "@/lib/molstar/style";
import {
  buildIsosurfaces,
  clearClip,
  colorReprByVolume,
  colorReprUniform,
  createMetricVolume,
  createSlice,
  loadStructureFactors,
  removeNode,
  setClipSphere,
  updateIsoSigma,
  updateSlice,
  TWO_FOFC_COLOR,
  type DensityReprs,
  type DensityVolumes,
  type MetricPoint,
} from "@/lib/molstar/density";
import { carveDensityToStructure } from "@/lib/molstar/carve";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";

// Density capability spike on the 7A1X qFit multiconformer model:
//   1. sf-cif (map coefficients) fetched from RCSB, FFT'd to 2Fo-Fc / Fo-Fc client-side,
//   2. isosurfaces with live sigma sliders,
//   3. clip sphere around the clicked residue (per-residue density),
//   4. arbitrary-axis slice plane through the clicked point,
//   5. 2Fo-Fc isosurface recolored by a conformer-count field computed with
//      @dynamic-pdb/hetkit (the package integration probe).

const MODEL_URL = "/corpus/7a1x_qFit_010.cif";
const SF_URL    = "https://files.rcsb.org/download/7A1X-sf.cif";

// Module-level so the load effect in MolstarViewer never sees a new identity: an inline
// literal here re-triggered clear()+load() on every status re-render, and a clear() lands
// mid density pipeline and deletes the volume nodes out from under it.
const VIEW: StructureView = { representation: "ball-and-stick", colorTheme: "alt-loc" };

type SliceAxis = "x" | "y" | "z";
const AXIS_NORMALS: Record<SliceAxis, [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

export default function DensitySpikePanel() {

  const [viewer, setViewer]             = useState<ViewerInstance | null>(null);
  const [modelText, setModelText]       = useState<string | null>(null);
  const [status, setStatus]             = useState<string>("loading model...");
  const [densityState, setDensityState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const volsRef      = useRef<DensityVolumes | null>(null);
  const reprsRef     = useRef<DensityReprs | null>(null);
  const tableRef     = useRef<AtomTable | null>(null);
  const trackRef     = useRef<Track | null>(null);
  const metricVolRef = useRef<string | null>(null);
  const sliceRef     = useRef<string | null>(null);

  const [show2fofc, setShow2fofc]   = useState(true);
  const [showFofc, setShowFofc]     = useState(true);
  const [sigma, setSigma]           = useState(1.5);
  const [clipOn, setClipOn]         = useState(false);
  const [clipRadius, setClipRadius] = useState(5);
  const [sliceOn, setSliceOn]       = useState(false);
  const [sliceAxis, setSliceAxis]   = useState<SliceAxis>("z");
  const [metricOn, setMetricOn]     = useState(false);
  const [picked, setPicked]         = useState<PickInfo | null>(null);
  const pickedRef                   = useRef<PickInfo | null>(null);

  // load the bundled qFit model + parse it once with hetkit
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(MODEL_URL);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const text = await res.text();
        if (cancelled) return;
        setModelText(text);
        setStatus("model loaded; load density to continue");
        const file = await parseCifText(text);
        const table = buildAtomTable(file);
        if (table) {
          tableRef.current = table;
          trackRef.current = conformerCount(table);
        }
      } catch (e) {
        if (!cancelled) setStatus(`model load failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // residue picking drives clip + slice anchors
  useEffect(() => {
    if (!viewer) return;
    return viewer.subscribeToClick((info) => {
      if (!info?.position3d) return;
      pickedRef.current = info;
      setPicked(info);
    });
  }, [viewer]);

  const allReprRefs = useCallback((): (string | null)[] => {
    const r = reprsRef.current;
    return r ? [r.twoFoFc, r.foFcPos, r.foFcNeg] : [];
  }, []);

  const loadDensity = useCallback(async () => {
    if (!viewer?.ctx || densityState === "loading" || densityState === "ready") return;
    setDensityState("loading");
    setStatus("fetching structure factors from RCSB (5.6 MB)...");
    try {
      const res = await fetch(SF_URL);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      setStatus("computing maps from map coefficients (client-side FFT)...");
      const vols = await loadStructureFactors(viewer.ctx, text, { entryId: "7A1X", label: "7A1X-sf" });
      if (!vols.twoFoFc && !vols.foFc) throw new Error("no map coefficients found in sf file");
      // The FFT grids cover one unit cell, away from the model; resample them around it.
      const structure = viewer.getCurrentStructure();
      if (structure) {
        setStatus("carving maps around the model...");
        carveDensityToStructure(viewer.ctx, vols, structure);
      }
      const reprs = await buildIsosurfaces(viewer.ctx, vols);
      volsRef.current = vols;
      reprsRef.current = reprs;
      setDensityState("ready");
      setStatus("density ready");
    } catch (e) {
      setDensityState("error");
      setStatus(`density failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [viewer, densityState]);

  // visibility toggles
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

  // sigma slider (2Fo-Fc only; Fo-Fc stays at +-3)
  useEffect(() => {
    const ctx = viewer?.ctx;
    const ref = reprsRef.current?.twoFoFc;
    if (!ctx || !ref || densityState !== "ready") return;
    const t = setTimeout(() => void updateIsoSigma(ctx, ref, sigma), 80);
    return () => clearTimeout(t);
  }, [viewer, sigma, densityState]);

  // clip sphere around the picked residue
  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || densityState !== "ready") return;
    const refs = allReprRefs();
    if (clipOn && pickedRef.current?.position3d) {
      void setClipSphere(ctx, refs, pickedRef.current.position3d, clipRadius);
    } else {
      void clearClip(ctx, refs);
    }
  }, [viewer, clipOn, clipRadius, picked, densityState, allReprRefs]);

  // slice plane through the picked point
  useEffect(() => {
    const ctx = viewer?.ctx;
    const vol = volsRef.current?.twoFoFc;
    if (!ctx || !vol || densityState !== "ready") return;
    const anchor = pickedRef.current?.position3d;
    if (sliceOn && anchor) {
      const normal = AXIS_NORMALS[sliceAxis];
      if (sliceRef.current) {
        void updateSlice(ctx, sliceRef.current, anchor, normal);
      } else {
        void createSlice(ctx, vol, anchor, normal).then((ref) => {
          sliceRef.current = ref;
        });
      }
    } else if (!sliceOn && sliceRef.current) {
      const ref = sliceRef.current;
      sliceRef.current = null;
      void removeNode(ctx, ref);
    }
  }, [viewer, sliceOn, sliceAxis, picked, densityState]);

  // metric projection: color the 2Fo-Fc isosurface by conformer count
  useEffect(() => {
    const ctx = viewer?.ctx;
    const repr = reprsRef.current?.twoFoFc;
    if (!ctx || !repr || densityState !== "ready") return;
    (async () => {
      if (metricOn) {
        const table = tableRef.current;
        const track = trackRef.current;
        if (!table || !track) {
          setStatus("hetkit table unavailable; cannot build metric field");
          return;
        }
        if (!metricVolRef.current) {
          const points: MetricPoint[] = [];
          for (let i = 0; i < table.count; i++) {
            if (!isHeavy(table, i)) continue;
            const ri = table.residueIndex.get(
              residueKey({ chain: table.chain[i], seq: table.seq[i], ins: table.ins[i] }),
            );
            if (ri === undefined) continue;
            const v = track.values[ri];
            if (Number.isNaN(v)) continue;
            points.push({ x: table.x[i], y: table.y[i], z: table.z[i], value: v });
          }
          setStatus(`splatting conformer-count field (${points.length} atoms)...`);
          metricVolRef.current = await createMetricVolume(ctx, points, {
            spacing: 1,
            radius: 2.5,
            label: "conformer count",
          });
        }
        await colorReprByVolume(ctx, repr, metricVolRef.current, [1, track.domain[1]]);
        setStatus("2Fo-Fc colored by conformer count (white 1, red high)");
      } else {
        await colorReprUniform(ctx, repr, TWO_FOFC_COLOR);
      }
    })().catch((e) => setStatus(`metric coloring failed: ${e instanceof Error ? e.message : String(e)}`));
  }, [viewer, metricOn, densityState]);

  const ready = densityState === "ready";

  return (
    <div className="flex h-screen min-h-0">
      <div className="relative min-w-0 flex-1">
        <MolstarViewer data={modelText} binary={false} view={VIEW} onReady={setViewer} />
      </div>
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-neutral-200 bg-neutral-50 p-3 text-[13px]">
        <div className="font-semibold">Density workbench: 7A1X qFit</div>
        <div className="text-neutral-500">{status}</div>

        <button
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-left hover:bg-neutral-100 disabled:opacity-40"
          onClick={() => void loadDensity()}
          disabled={!viewer || !modelText || densityState === "loading" || ready}
        >
          {ready ? "Density loaded" : densityState === "loading" ? "Loading..." : "Load density (RCSB 7A1X-sf.cif)"}
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

        <div className="mt-2 border-t border-neutral-200 pt-2 font-semibold">Per-residue density</div>
        <div className="text-neutral-500">
          {picked ? `anchor: ${picked.compId} ${picked.chainId}/${picked.authSeqId}` : "click an atom to set the anchor"}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={clipOn} disabled={!ready || !picked} onChange={(e) => setClipOn(e.target.checked)} />
          <span>Clip density to anchor</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-600">Clip radius: {clipRadius.toFixed(0)} A</span>
          <input
            type="range"
            min={2}
            max={15}
            step={1}
            value={clipRadius}
            disabled={!ready || !clipOn}
            onChange={(e) => setClipRadius(Number(e.target.value))}
          />
        </label>

        <div className="mt-2 border-t border-neutral-200 pt-2 font-semibold">Slice</div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={sliceOn} disabled={!ready || !picked} onChange={(e) => setSliceOn(e.target.checked)} />
          <span>Slice plane through anchor</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-neutral-600">normal:</span>
          {(["x", "y", "z"] as SliceAxis[]).map((axis) => (
            <label key={axis} className="flex items-center gap-1">
              <input
                type="radio"
                name="slice-axis"
                checked={sliceAxis === axis}
                disabled={!ready || !sliceOn}
                onChange={() => setSliceAxis(axis)}
              />
              <span>{axis}</span>
            </label>
          ))}
        </div>

        <div className="mt-2 border-t border-neutral-200 pt-2 font-semibold">Metric projection</div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={metricOn} disabled={!ready} onChange={(e) => setMetricOn(e.target.checked)} />
          <span>Color 2Fo-Fc by conformer count</span>
        </label>
        <div className="text-neutral-500">
          Splats the per-residue conformer count (computed with hetkit) onto a 1 A grid and paints the
          isosurface with the external-volume theme.
        </div>
      </div>
    </div>
  );
}
