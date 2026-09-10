"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MolstarViewer from "@/components/MolstarViewer";
import type { MolstarViewer as ViewerInstance, PickInfo } from "@/lib/molstar/viewer";
import { GHOST_B_COLOR, MODEL_A_COLOR, type StructureView } from "@/lib/molstar/style";
import {
  buildIsosurfaces,
  clipPlaneObject,
  clipSphereObject,
  createSlice,
  DENSITY_QUALITY,
  loadStructureFactors,
  removeNode,
  setClipObjects,
  setDensityAlpha,
  setReprsPickable,
  TWO_FOFC_COLOR,
  updateIsoSigma,
  updateSlice,
  type DensityQuality,
  type DensityReprs,
  type DensityVolumes,
} from "@/lib/molstar/density";
import { CARVE_RADIUS, carveDensityToStructure } from "@/lib/molstar/carve";
import { applyRepStyle, DEFAULT_REP_STYLE, type RepStyle } from "@/lib/molstar/repstyle";
import {
  applyConformerStyling,
  applySecondaryGhost,
  planConformers,
  representationRefsForStructure,
  residueIdKey,
  type ResidueRange,
} from "@/lib/molstar/conformers";
import { MetricProjector, samplerForVolume, trackToPoints } from "@/lib/molstar/project";
import { buildResidueQuery, executeQuery } from "@/lib/molstar/queries";
import SlicePanel, { type SlicePlane } from "@/components/lab/SlicePanel";
import ConformerBarplot, { type ConformerBar } from "@/components/lab/compare/ConformerBarplot";
import ConformerStatesPanel from "@/components/lab/compare/ConformerStatesPanel";
import DensityControls from "@/components/lab/compare/DensityControls";
import LoaderPanel from "@/components/lab/compare/LoaderPanel";
import MetricsToolbar, { type ScopeMode } from "@/components/lab/compare/MetricsToolbar";
import SelectionActionsPopup, { type ActionTarget, type ClipMode } from "@/components/lab/compare/SelectionActionsPopup";
import SelectionPanel from "@/components/lab/compare/SelectionPanel";
import StyleTray from "@/components/lab/compare/StyleTray";
import { METRIC_UI, metricLabel, metricUnit, type MetricId } from "@/components/lab/compare/metrics";
import { SectionLabel } from "@/components/lab/compare/ui";
import { findEntry, type EntryDef, type ProvenanceRecord, type StageId, type StageState } from "@/lib/lab/entries";
import {
  buildAtomTable,
  parseCifText,
  residueKey,
  summarizeAltlocs,
  type AtomTable,
  type ResidueRef,
} from "@dynamic-pdb/hetkit/model";
import {
  altlocRmsf,
  mapSupportDelta,
  mapValueTracks,
  modelRmsd,
  scopeTrack,
  trackDelta,
  type Track,
} from "@dynamic-pdb/hetkit/metrics";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";

// Compare lab: TWO models of one entry against their shared map. Model A is the qFit
// multiconformer rendered as SOLID warm camel sticks (MODEL_A_COLOR, shared with the 1D
// strip) COLLAPSED to its highest-occupancy conformer — expand per residue via the
// Selection Actions Panel on right click, or force one letter everywhere with the
// Conformer state buttons; model B is the deposited model as a cool ghost, hidden until
// toggled on. Density + metric projection + slice ride on top. Decisions and progress:
// docs/roadmap.md.

const VIEW: StructureView = { representation: "ball-and-stick", colorTheme: "uniform", uniformColor: MODEL_A_COLOR };
const DEFAULT_ENTRY = "7A1X";
const DEFAULT_CLIP_RADIUS = 5;
const WATER_COMPS = new Set(["HOH", "DOD", "WAT"]);

function initialStages(): Record<StageId, StageState> {
  return { models: "pending", tables: "pending", "sf-fetch": "pending", fft: "pending", carve: "pending", iso: "pending" };
}

function residueCentroid(table: AtomTable, picked: PickInfo): [number, number, number] | null {
  let n = 0, x = 0, y = 0, z = 0;
  table.residues.forEach((res) => {
    if (res.ref.chain !== picked.chainId || res.ref.seq !== picked.authSeqId) return;
    for (const r of res.rows) {
      const e = table.element[r];
      if (e === "H" || e === "D") continue;
      n++; x += table.x[r]; y += table.y[r]; z += table.z[r];
    }
  });
  return n > 0 ? [x / n, y / n, z / n] : null;
}

// Heavy-atom centroid of a whole residue range plus the radius that encloses it — the
// range popup's clip sphere starts at fitRadius instead of the single-residue default.
function rangeStats(
  table: AtomTable,
  range: ResidueRange,
): { centroid: [number, number, number]; fitRadius: number } | null {
  const rows: number[] = [];
  let x = 0, y = 0, z = 0;
  table.residues.forEach((res) => {
    if (res.ref.chain !== range.chain || res.ref.seq < range.from || res.ref.seq > range.to) return;
    for (const r of res.rows) {
      const e = table.element[r];
      if (e === "H" || e === "D") continue;
      rows.push(r);
      x += table.x[r]; y += table.y[r]; z += table.z[r];
    }
  });
  if (!rows.length) return null;
  const c: [number, number, number] = [x / rows.length, y / rows.length, z / rows.length];
  let maxD2 = 0;
  for (const r of rows) {
    const dx = table.x[r] - c[0], dy = table.y[r] - c[1], dz = table.z[r] - c[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > maxD2) maxD2 = d2;
  }
  return { centroid: c, fitRadius: Math.sqrt(maxD2) + 2.5 };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

export default function CompareLabPanel() {
  const [viewer, setViewer] = useState<ViewerInstance | null>(null);

  // --- loader / entry state ---
  const [entryInput, setEntryInput] = useState(DEFAULT_ENTRY);
  const [entry, setEntry] = useState<EntryDef | null>(null);
  const [loading, setLoading] = useState(false);
  const [stages, setStages] = useState<Record<StageId, StageState>>(initialStages());
  const [provenance, setProvenance] = useState<ProvenanceRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [aText, setAText] = useState<string | null>(null);
  const [bText, setBText] = useState<string | null>(null);
  const [aTable, setATable] = useState<AtomTable | null>(null);
  const [bTable, setBTable] = useState<AtomTable | null>(null);
  const [primaryLoaded, setPrimaryLoaded] = useState(false);
  const [secondaryRef, setSecondaryRef] = useState<string | null>(null);
  const [showB, setShowB] = useState(false);

  // --- density state ---
  const [densityState, setDensityState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [showDensity, setShowDensity] = useState(true); // master switch over both maps
  const [show2fofc, setShow2fofc] = useState(true);
  const [showFofc, setShowFofc] = useState(false);
  const [sigma, setSigma] = useState(1.5);
  const [box, setBox] = useState<{ min: [number, number, number]; max: [number, number, number] } | null>(null);

  // --- selection / conformers / clip ---
  const [picked, setPicked] = useState<PickInfo | null>(null);
  const [selRange, setSelRange] = useState<ResidueRange | null>(null);
  const [hoverInfo, setHoverInfo] = useState<PickInfo | null>(null);
  const [shownConformers, setShownConformers] = useState<ReadonlySet<string>>(new Set());
  const [globalAlt, setGlobalAlt] = useState<string | null>(null);
  const [clip, setClip] = useState<{
    center: [number, number, number];
    radius: number;
    includeModel: boolean;
  } | null>(null);
  // range: true when the right click landed inside the current range selection, so the
  // actions panel targets the whole range instead of one residue
  const [popup, setPopup] = useState<{ x: number; y: number; range: boolean } | null>(null);

  // --- metric / scope ---
  const [metricId, setMetricId] = useState<MetricId | "none">("none");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [rangeChain, setRangeChain] = useState("A");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [projected, setProjected] = useState<{ id: MetricId; domain: [number, number] } | null>(null);
  const [projVersion, setProjVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  // the scoped track behind the current 3D projection, rendered as the barplot's metric lane
  const [activeTrack, setActiveTrack] = useState<{ id: MetricId; track: Track } | null>(null);

  // --- slice ---
  const [slice3d, setSlice3d] = useState(false);
  const [sliceModel, setSliceModel] = useState(false);
  const [planeVersion, setPlaneVersion] = useState(0);

  // --- style (tray) ---
  const [repStyle, setRepStyle] = useState<RepStyle>(DEFAULT_REP_STYLE);
  const [densityOpacity, setDensityOpacity] = useState(1);
  const [densityQuality, setDensityQuality] = useState<DensityQuality>("auto");
  const [densityBusy, setDensityBusy] = useState(false);
  // bumps whenever the density reprs are torn down and rebuilt (quality change): clip,
  // visibility, opacity and metric projection re-apply to the NEW repr refs
  const [densityVersion, setDensityVersion] = useState(0);

  const volsRef = useRef<DensityVolumes | null>(null);
  const reprsRef = useRef<DensityReprs | null>(null);
  const projectorRef = useRef(new MetricProjector());
  const secondaryBusyRef = useRef(false);
  const densityRunRef = useRef<string | null>(null);
  const planeRef = useRef<SlicePlane | null>(null);
  const slice3dNodeRef = useRef<string | null>(null);
  const planeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverKeyRef = useRef<string | null>(null);
  const selRangeRef = useRef<ResidueRange | null>(null); // click handler reads the live range
  const autoLoadRef = useRef(false);

  // Serialize async Mol* pipelines: nothing runs concurrently, and while busy the
  // latest request wins PER KEY — rapid updates of one concern (say, conformer styling
  // on every pick) collapse to the newest, without dropping a different concern (say,
  // the ghost transparency or a representation switch) that queued in between.
  const makeSerializer = () => {
    const busy = { current: false };
    const pending = new Map<string, () => Promise<void>>();
    const run = (key: string, fn: () => Promise<void>, onError: (e: unknown) => void) => {
      if (busy.current) {
        pending.set(key, fn);
        return;
      }
      busy.current = true;
      void fn()
        .catch(onError)
        .finally(() => {
          busy.current = false;
          const next = pending.entries().next();
          if (!next.done) {
            const [k, p] = next.value;
            pending.delete(k);
            run(k, p, onError);
          }
        });
    };
    return run;
  };
  const runProjectionRef = useRef(makeSerializer());
  const runStylingRef = useRef(makeSerializer());
  const runProjection = useCallback((fn: () => Promise<void>) => {
    runProjectionRef.current("projection", fn, (e) =>
      setStatus(`projection failed: ${e instanceof Error ? e.message : String(e)}`),
    );
  }, []);
  const runStyling = useCallback((key: string, fn: () => Promise<void>) => {
    runStylingRef.current(key, fn, (e) => console.error("styling failed:", e));
  }, []);

  const setStage = useCallback((id: StageId, s: StageState) => {
    setStages((prev) => ({ ...prev, [id]: s }));
  }, []);

  // --- load flow: entry -> model files -> tables (density chains in its own effect) ---

  const startLoad = useCallback(
    (id: string) => {
      const def = findEntry(id);
      if (!def) {
        setLoadError(`unknown entry "${id.trim()}" — available: 7A1X, 9JD2`);
        return;
      }
      setLoadError(null);
      setEntry(def);
      setEntryInput(def.id);
      setLoading(true);

      // reset everything scene-derived; setting new texts clears the Mol* state tree
      setPrimaryLoaded(false);
      setSecondaryRef(null);
      setAText(null);
      setBText(null);
      setATable(null);
      setBTable(null);
      setDensityState("idle");
      setDensityQuality("auto"); // a fresh entry builds its maps at the default budget
      setDensityBusy(false);
      volsRef.current = null;
      reprsRef.current = null;
      slice3dNodeRef.current = null;
      densityRunRef.current = null;
      planeRef.current = null;
      projectorRef.current = new MetricProjector();
      setProjected(null);
      setActiveTrack(null);
      setBox(null);
      setPicked(null);
      setSelRange(null);
      setHoverInfo(null);
      setShownConformers(new Set());
      setGlobalAlt(null);
      setClip(null);
      setPopup(null);
      setStatus(null);
      setProvenance([]);
      setStages({ ...initialStages(), models: "active" });

      void (async () => {
        try {
          const [aT, bT] = await Promise.all([fetchText(def.qfit.url), fetchText(def.deposited.url)]);
          setStage("models", "done");
          setProvenance([
            { role: "model A", desc: def.qfit.note, url: def.qfit.url },
            { role: "model B", desc: def.deposited.note, url: def.deposited.url },
          ]);
          setAText(aT);
          setBText(bT);
          setStage("tables", "active");
          const [tA, tB] = await Promise.all([
            parseCifText(aT).then(buildAtomTable),
            parseCifText(bT).then(buildAtomTable),
          ]);
          setATable(tA);
          setBTable(tB);
          setStage("tables", "done");
        } catch (e) {
          setStages((prev) => {
            const next = { ...prev };
            if (next.models === "active") next.models = "error";
            if (next.tables === "active") next.tables = "error";
            return next;
          });
          setLoadError(`load failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setLoading(false);
        }
      })();
    },
    [setStage],
  );

  useEffect(() => {
    if (autoLoadRef.current) return;
    autoLoadRef.current = true;
    startLoad(DEFAULT_ENTRY);
  }, [startLoad]);

  // --- second model into the same scene, once the primary is in ---

  useEffect(() => {
    if (!viewer || !primaryLoaded || !bText || !entry || secondaryRef || secondaryBusyRef.current) return;
    secondaryBusyRef.current = true;
    viewer
      .loadSecondary(bText, { label: `${entry.id} deposited`, color: GHOST_B_COLOR })
      .then((ref) => setSecondaryRef(ref))
      .catch((e) => setLoadError(`model B failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        secondaryBusyRef.current = false;
      });
  }, [viewer, primaryLoaded, bText, entry, secondaryRef]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !secondaryRef) return;
    runStyling("ghost", () => applySecondaryGhost(ctx, secondaryRef));
  }, [viewer, secondaryRef, runStyling]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !secondaryRef) return;
    setSubtreeVisibility(ctx.state.data, secondaryRef, !showB);
  }, [viewer, secondaryRef, showB]);

  // --- single-conformer collapse (per-residue expansion + naive global letter state) ---

  const altSummary = useMemo(() => (aTable ? summarizeAltlocs(aTable) : null), [aTable]);
  const confPlan = useMemo(() => planConformers(altSummary), [altSummary]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !primaryLoaded) return;
    const structureRef = viewer.getPrimaryStructureRef();
    if (!structureRef) return;
    runStyling("conformers", () =>
      applyConformerStyling(ctx, structureRef, confPlan, { shown: shownConformers, globalAlt }),
    );
  }, [viewer, primaryLoaded, confPlan, shownConformers, globalAlt, runStyling]);

  // --- representation style (tray): in-place state-tree updates on both models ---

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !viewer || !primaryLoaded) return;
    const structureRef = viewer.getPrimaryStructureRef();
    if (!structureRef) return;
    runStyling("rep-a", () => applyRepStyle(ctx, structureRef, repStyle, { uniformColor: MODEL_A_COLOR }));
  }, [viewer, primaryLoaded, repStyle, runStyling]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !secondaryRef) return;
    runStyling("rep-b", () => applyRepStyle(ctx, secondaryRef, repStyle, { uniformColor: GHOST_B_COLOR, ghost: true }));
  }, [viewer, secondaryRef, repStyle, runStyling]);

  // --- selection marking: the picked residue / barplot range becomes a Mol* selection
  // (the default green select tint), replacing the old navy overpaint. Declared AFTER
  // the rep-style effects and keyed separately in the serializer, so on a representation
  // rebuild (which drops marker state) the re-assert runs last; conformer restyles are
  // deps for the same reason.

  useEffect(() => {
    if (!viewer || !primaryLoaded) return;
    runStyling("selection", async () => {
      const structure = viewer.getCurrentStructure();
      if (!structure) return;
      const expr = selRange
        ? buildResidueQuery(selRange.chain, selRange.from, selRange.to)
        : picked
          ? buildResidueQuery(picked.chainId, picked.authSeqId)
          : null;
      const loci = expr ? executeQuery(expr, structure) : null;
      if (loci) viewer.setSelection(loci);
      else viewer.clearSelection();
    });
  }, [viewer, primaryLoaded, picked, selRange, repStyle, shownConformers, globalAlt, confPlan, runStyling]);

  // --- interaction: left click selects; right click opens the Selection Actions Panel —
  // on the picked residue, or on the WHOLE range selection when the click lands inside
  // it. Both ride Mol*'s click event, which fires for any button with a FRESH synchronous
  // pick at the release point (hover is async/throttled and used to go stale here) and
  // already rejects camera drags (no click when the pointer moved between down and up).
  // contextmenu is only suppressed (it fires on mousedown on macOS).

  useEffect(() => {
    selRangeRef.current = selRange;
  }, [selRange]);

  useEffect(() => {
    if (!viewer) return;
    return viewer.subscribeToClick((info, meta) => {
      if (meta.button === 2) {
        if (info && meta.clientX != null && meta.clientY != null) {
          const r = selRangeRef.current;
          const inRange = !!r && info.chainId === r.chain && info.authSeqId >= r.from && info.authSeqId <= r.to;
          if (!inRange) {
            setPicked(info);
            setSelRange(null);
          }
          setPopup({ x: meta.clientX, y: meta.clientY, range: inRange });
        } else {
          setPopup(null);
        }
        return;
      }
      setPicked(info);
      setSelRange(null); // a 3D click supersedes any barplot range selection
      setPopup(null);
    });
  }, [viewer]);

  useEffect(() => {
    if (!viewer) return;
    return viewer.subscribeToHover((info) => {
      const key = info ? `${info.chainId}|${info.authSeqId}|${info.insCode}` : null;
      if (key !== hoverKeyRef.current) {
        hoverKeyRef.current = key;
        setHoverInfo(info);
      }
    });
  }, [viewer]);

  // --- density: chains automatically once both models are in the scene ---

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !entry || !primaryLoaded || !secondaryRef || !aTable) return;
    if (densityState !== "idle" || densityRunRef.current === entry.id) return;
    densityRunRef.current = entry.id;
    setDensityState("loading");
    // an entry switch (or retry) rewrites densityRunRef; a stale in-flight run must stop
    // touching state that now belongs to the new entry
    const stale = () => densityRunRef.current !== entry.id;
    void (async () => {
      try {
        setStage("sf-fetch", "active");
        const text = await fetchText(entry.sf.url);
        if (stale()) return;
        setStage("sf-fetch", "done");
        setProvenance((prev) => [
          ...prev.filter((p) => p.role !== "structure factors" && p.role !== "maps"),
          { role: "structure factors", desc: `${entry.sf.note} (~${entry.sf.approxMB} MB)`, url: entry.sf.url },
        ]);
        setStage("fft", "active");
        const vols = await loadStructureFactors(ctx, text, { entryId: entry.id, label: `${entry.id}-sf` });
        if (stale()) return;
        if (!vols.twoFoFc && !vols.foFc) throw new Error("no map coefficients found in the sf file");
        setStage("fft", "done");
        setStage("carve", "active");
        const structure = viewer?.getCurrentStructure();
        if (!structure) throw new Error("no structure loaded to carve around");
        carveDensityToStructure(ctx, vols, structure);
        setStage("carve", "done");
        setStage("iso", "active");
        const reprs = await buildIsosurfaces(ctx, vols);
        if (stale()) return;
        setStage("iso", "done");
        volsRef.current = vols;
        reprsRef.current = reprs;
        const b = structure.boundary.box;
        setBox({ min: [b.min[0], b.min[1], b.min[2]], max: [b.max[0], b.max[1], b.max[2]] });
        setProvenance((prev) => [
          ...prev,
          {
            role: "maps",
            desc: "2Fo-Fc / Fo-Fc: client-side FFT of the sf-cif's 2mFo-DFc / mFo-DFc coefficients (Mol* sfcif provider), carved to the model; not fetched — computed in the browser",
          },
        ]);
        setDensityState("ready");
      } catch (e) {
        if (stale()) return;
        setStages((prev) => {
          const next = { ...prev };
          for (const s of ["sf-fetch", "fft", "carve", "iso"] as StageId[]) {
            if (next[s] === "active") next[s] = "error";
          }
          return next;
        });
        setDensityState("error");
        setLoadError(`density failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, [viewer, entry, primaryLoaded, secondaryRef, aTable, densityState, setStage]);

  const retryDensity = useCallback(() => {
    densityRunRef.current = null;
    setLoadError(null);
    setStages((prev) => ({ ...prev, "sf-fetch": "pending", fft: "pending", carve: "pending", iso: "pending" }));
    setDensityState("idle");
  }, []);

  // --- density layer visibility + contour (the master switch gates both maps) ---

  useEffect(() => {
    const ctx = viewer?.ctx;
    const r = reprsRef.current;
    if (!ctx || !r?.twoFoFc) return;
    setSubtreeVisibility(ctx.state.data, r.twoFoFc, !(show2fofc && showDensity));
  }, [viewer, show2fofc, showDensity, densityState, densityVersion]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    const r = reprsRef.current;
    if (!ctx) return;
    for (const ref of [r?.foFcPos, r?.foFcNeg]) {
      if (ref) setSubtreeVisibility(ctx.state.data, ref, !(showFofc && showDensity));
    }
  }, [viewer, showFofc, showDensity, densityState, densityVersion]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    const ref = reprsRef.current?.twoFoFc;
    if (!ctx || !ref || densityState !== "ready") return;
    const t = setTimeout(() => void updateIsoSigma(ctx, ref, sigma), 80);
    return () => clearTimeout(t);
  }, [viewer, sigma, densityState, densityVersion]);

  // opacity slider: factor over both maps' base alphas, debounced like the contour
  useEffect(() => {
    const ctx = viewer?.ctx;
    const r = reprsRef.current;
    if (!ctx || !r || densityState !== "ready") return;
    const t = setTimeout(() => void setDensityAlpha(ctx, r, densityOpacity), 80);
    return () => clearTimeout(t);
  }, [viewer, densityOpacity, densityState, densityVersion]);

  // --- density quality: re-carve from the pristine grids, tear down + rebuild surfaces ---

  const changeDensityQuality = useCallback(
    (q: DensityQuality) => {
      const ctx = viewer?.ctx;
      const vols = volsRef.current;
      const oldReprs = reprsRef.current;
      if (!ctx || !viewer || !vols || !oldReprs || densityState !== "ready" || densityBusy) return;
      if (q === densityQuality) return;
      const structure = viewer.getCurrentStructure();
      if (!structure) return;
      setDensityQuality(q);
      setDensityBusy(true);
      const spec = DENSITY_QUALITY[q];
      void (async () => {
        try {
          carveDensityToStructure(ctx, vols, structure, CARVE_RADIUS, { maxPoints: spec.maxPoints });
          // the carve swapped the grids under the volumes outside the state tree, so the
          // surfaces are rebuilt rather than updated in place
          for (const ref of [oldReprs.twoFoFc, oldReprs.foFcPos, oldReprs.foFcNeg]) {
            if (ref) await removeNode(ctx, ref);
          }
          if (slice3dNodeRef.current) {
            await removeNode(ctx, slice3dNodeRef.current);
            slice3dNodeRef.current = null;
          }
          reprsRef.current = await buildIsosurfaces(ctx, vols, {
            sigma,
            alphaFactor: densityOpacity,
            gpuDataType: spec.gpuDataType,
          });
          if (slice3d && vols.twoFoFc && planeRef.current) {
            const p = planeRef.current;
            slice3dNodeRef.current = await createSlice(ctx, vols.twoFoFc, p.point, p.normal);
          }
          setDensityVersion((v) => v + 1);
        } catch (e) {
          setStatus(`density quality change failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setDensityBusy(false);
        }
      })();
    },
    [viewer, densityState, densityBusy, densityQuality, sigma, densityOpacity, slice3d],
  );

  // --- clip composition: residue sphere on the density (and, when isolating, on the
  // models too), slice plane on density + models ---

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !viewer) return;
    const plane = planeRef.current;
    const planeObj = sliceModel && plane ? clipPlaneObject(plane.point, plane.normal) : null;
    const sphereObj = clip ? clipSphereObject(clip.center, clip.radius) : null;
    const r = reprsRef.current;
    if (r && densityState === "ready") {
      const densityObjs = [...(sphereObj ? [sphereObj] : []), ...(planeObj ? [planeObj] : [])];
      const densityRefs = [r.twoFoFc, r.foFcPos, r.foFcNeg];
      // re-assert after the update: a recreated isosurface visual comes back pickable
      void setClipObjects(ctx, densityRefs, densityObjs).then(() => setReprsPickable(ctx, densityRefs, false));
    }
    const primaryStructureRef = viewer.getPrimaryStructureRef();
    const structReprs = [
      ...(primaryStructureRef ? representationRefsForStructure(ctx, primaryStructureRef) : []),
      ...(secondaryRef ? representationRefsForStructure(ctx, secondaryRef) : []),
    ];
    const structObjs = [
      ...(clip?.includeModel && sphereObj ? [sphereObj] : []),
      ...(planeObj ? [planeObj] : []),
    ];
    if (structReprs.length) void setClipObjects(ctx, structReprs, structObjs);
    // repStyle: a full-params representation update wipes type.params.clip, so clip
    // re-applies after every style change; densityVersion: same, for rebuilt surfaces.
  }, [viewer, clip, sliceModel, planeVersion, densityState, secondaryRef, primaryLoaded, repStyle, densityVersion]);

  // --- metric computation + projection onto the 2Fo-Fc surface ---

  const scopePredicate = useCallback((): ((ref: ResidueRef) => boolean) | null => {
    if (scopeMode === "all") return () => true;
    if (scopeMode === "residue") {
      if (!picked) return null;
      const { chainId, authSeqId } = picked;
      return (ref) => ref.chain === chainId && ref.seq === authSeqId;
    }
    const from = parseInt(rangeFrom, 10);
    const to = parseInt(rangeTo, 10);
    if (!rangeChain || Number.isNaN(from) || Number.isNaN(to)) return null;
    return (ref) => ref.chain === rangeChain && ref.seq >= from && ref.seq <= to;
  }, [scopeMode, picked, rangeChain, rangeFrom, rangeTo]);

  const computeBaseTrack = useCallback(
    (id: MetricId): Track | null => {
      const ctx = viewer?.ctx;
      if (!ctx || !aTable) return null;
      switch (id) {
        case "model-rmsd":
          return bTable ? modelRmsd(aTable, bTable) : null;
        case "altloc-rmsf-delta":
          return bTable ? trackDelta(altlocRmsf(aTable), altlocRmsf(bTable), { metricId: "altloc-rmsf-delta" }) : null;
        case "fofc-mean":
        case "fofc-peak": {
          const s = samplerForVolume(ctx, volsRef.current?.foFc ?? null, { relative: true });
          if (!s) return null;
          const tracks = mapValueTracks(aTable, s, { idPrefix: "fofc" });
          return id === "fofc-mean" ? tracks.mean : tracks.peak;
        }
        case "support-delta": {
          const s = samplerForVolume(ctx, volsRef.current?.twoFoFc ?? null, { relative: true });
          return s && bTable ? mapSupportDelta(aTable, bTable, s) : null;
        }
      }
    },
    [viewer, aTable, bTable],
  );

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !aTable) return;
    const r = reprsRef.current;
    if (metricId === "none") {
      setActiveTrack(null);
      if (r?.twoFoFc && projectorRef.current.getVolumeRef()) {
        runProjection(async () => {
          await projectorRef.current.clear(ctx, new Map([[r.twoFoFc as string, TWO_FOFC_COLOR]]));
          setProjected(null);
          setProjVersion((v) => v + 1);
          setStatus(null);
        });
      }
      return;
    }
    const ui = METRIC_UI[metricId];
    if (densityState !== "ready" || !r?.twoFoFc) return; // the projection target is the 2Fo-Fc surface
    if (ui.pair && !bTable) return;
    const t = setTimeout(() => {
      const base = computeBaseTrack(metricId);
      if (!base) {
        setActiveTrack(null);
        return;
      }
      const pred = scopePredicate();
      if (!pred) {
        setActiveTrack(null);
        setStatus(scopeMode === "residue" ? "click a residue in 3D to scope" : "fill in chain and range to scope");
        return;
      }
      const scoped = scopeTrack(base, pred);
      setActiveTrack({ id: metricId, track: scoped });
      const domain: [number, number] = ui.sequential ? [0, base.domain[1]] : base.domain;
      let points = trackToPoints(aTable, scoped);
      if (ui.unionSplat && bTable) points = points.concat(trackToPoints(bTable, scoped));
      if (!points.length) {
        setStatus("scope selects nothing");
        return;
      }
      runProjection(async () => {
        await projectorRef.current.project(ctx, {
          points,
          targets: [r.twoFoFc],
          domain,
          colors: ui.colors,
          label: metricLabel(metricId),
        });
        setProjected({ id: metricId, domain });
        setProjVersion((v) => v + 1);
        setStatus(`${metricLabel(metricId)}: projected from ${points.length} atoms`);
      });
    }, 120);
    return () => clearTimeout(t);
  }, [
    viewer, aTable, bTable, metricId, densityState, densityVersion,
    scopeMode, picked, rangeChain, rangeFrom, rangeTo,
    computeBaseTrack, scopePredicate, runProjection,
  ]);

  // --- samplers for the slice panel + support table ---

  const densitySampler = useMemo(() => {
    const ctx = viewer?.ctx;
    if (!ctx || densityState !== "ready") return null;
    return samplerForVolume(ctx, volsRef.current?.twoFoFc ?? null, { relative: true });
  }, [viewer, densityState]);

  const fofcSampler = useMemo(() => {
    const ctx = viewer?.ctx;
    if (!ctx || densityState !== "ready") return null;
    return samplerForVolume(ctx, volsRef.current?.foFc ?? null, { relative: true });
  }, [viewer, densityState]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const metricSampler = useMemo(() => {
    const ctx = viewer?.ctx;
    if (!ctx) return null;
    return projectorRef.current.sampler(ctx);
  }, [viewer, projVersion]);

  // --- slice plane wiring ---

  const onPlaneChange = useCallback(
    (plane: SlicePlane) => {
      planeRef.current = plane;
      if (planeTimerRef.current) clearTimeout(planeTimerRef.current);
      planeTimerRef.current = setTimeout(() => {
        setPlaneVersion((v) => v + 1);
        const ctx = viewer?.ctx;
        if (ctx && slice3dNodeRef.current) {
          void updateSlice(ctx, slice3dNodeRef.current, plane.point, plane.normal);
        }
      }, 60);
    },
    [viewer],
  );

  useEffect(() => {
    const ctx = viewer?.ctx;
    const vol = volsRef.current?.twoFoFc;
    if (!ctx || !vol || densityState !== "ready") return;
    if (slice3d && !slice3dNodeRef.current && planeRef.current) {
      const p = planeRef.current;
      void createSlice(ctx, vol, p.point, p.normal).then((ref) => {
        slice3dNodeRef.current = ref;
      });
    } else if (!slice3d && slice3dNodeRef.current) {
      void removeNode(ctx, slice3dNodeRef.current);
      slice3dNodeRef.current = null;
    }
    // planeVersion: after an entry switch planeRef is null until the slice panel re-emits;
    // the bump retries the create once a plane exists again.
  }, [viewer, slice3d, densityState, planeVersion]);

  // --- selection helpers (popup + barplot) ---

  const pickedKey = picked ? residueIdKey({ chain: picked.chainId, seq: picked.authSeqId, ins: picked.insCode }) : null;
  const pickedAltIds = pickedKey ? (confPlan.byKey.get(pickedKey)?.altIds ?? []) : [];
  const pickedConformerCount = pickedKey ? (pickedAltIds.length || 1) : null;
  const pickedShown = !!(pickedKey && shownConformers.has(pickedKey));

  // aggregates of the current range selection: what the range-mode actions panel acts on
  const rangeInfo = useMemo(() => {
    if (!aTable || !selRange) return null;
    const splitKeys: string[] = [];
    const letters = new Set<string>();
    let residueCount = 0;
    for (const res of aTable.residues) {
      if (WATER_COMPS.has(res.compId)) continue;
      if (res.ref.chain !== selRange.chain || res.ref.seq < selRange.from || res.ref.seq > selRange.to) continue;
      residueCount++;
      const key = residueKey(res.ref);
      const alt = confPlan.byKey.get(key);
      if (alt && alt.altIds.length > 1) {
        splitKeys.push(key);
        for (const l of alt.altIds) letters.add(l);
      }
    }
    return { residueCount, splitKeys, letters: [...letters].sort(), stats: rangeStats(aTable, selRange) };
  }, [aTable, selRange, confPlan]);

  const popupIsRange = !!popup?.range && !!selRange && !!rangeInfo;
  const popupShown = popupIsRange
    ? rangeInfo!.splitKeys.length > 0 && rangeInfo!.splitKeys.every((k) => shownConformers.has(k))
    : pickedShown;

  // residue mode toggles the picked residue; range mode toggles EVERY split residue of
  // the range at once (all shown -> collapse all, otherwise expand all)
  const togglePopupConformers = useCallback(() => {
    if (popupIsRange) {
      const keys = rangeInfo!.splitKeys;
      if (!keys.length) return;
      setShownConformers((prev) => {
        const next = new Set(prev);
        const allShown = keys.every((k) => next.has(k));
        for (const k of keys) {
          if (allShown) next.delete(k);
          else next.add(k);
        }
        return next;
      });
      return;
    }
    if (!pickedKey) return;
    setShownConformers((prev) => {
      const next = new Set(prev);
      if (next.has(pickedKey)) next.delete(pickedKey);
      else next.add(pickedKey);
      return next;
    });
  }, [popupIsRange, rangeInfo, pickedKey]);

  const applyClip = useCallback(
    (mode: ClipMode, radius: number) => {
      if (mode === "off") {
        setClip(null);
        return;
      }
      if (!aTable) return;
      const c = popupIsRange
        ? (rangeInfo!.stats?.centroid ?? null)
        : picked
          ? residueCentroid(aTable, picked)
          : null;
      if (c) setClip({ center: c, radius, includeModel: mode === "all" });
    },
    [popupIsRange, rangeInfo, picked, aTable],
  );

  const clearSelection = useCallback(() => {
    setPicked(null);
    setSelRange(null);
    setClip(null);
    setPopup(null);
    setScopeMode("all");
  }, []);

  // every altloc letter of model A, with how many residues carry it (the state buttons)
  const stateLetters = useMemo(() => {
    if (!altSummary) return [];
    return altSummary.altIds.map((letter) => ({
      letter,
      residueCount: altSummary.residues.filter((r) => r.altIds.includes(letter)).length,
    }));
  }, [altSummary]);

  const bars = useMemo(() => {
    if (!aTable) return null;
    const out: ConformerBar[] = [];
    let maxCount = 2;
    for (const res of aTable.residues) {
      if (WATER_COMPS.has(res.compId)) continue;
      const key = residueKey(res.ref);
      const count = confPlan.byKey.get(key)?.altIds.length ?? 1;
      if (count > maxCount) maxCount = count;
      out.push({ key, chain: res.ref.chain, seq: res.ref.seq, ins: res.ref.ins, compId: res.compId, count });
    }
    return { list: out, maxCount };
  }, [aTable, confPlan]);

  // active metric values in bars order (the barplot's metric lane); NaN where the track
  // has no value for a residue (out of scope, or missing from model A's key set)
  const laneValues = useMemo(() => {
    if (!bars || !activeTrack) return null;
    const byKey = new Map<string, number>();
    const { keys, values } = activeTrack.track;
    keys.forEach((k, i) => byKey.set(residueKey(k), values[i]));
    const out = new Float32Array(bars.list.length);
    for (let i = 0; i < bars.list.length; i++) out[i] = byKey.get(bars.list[i].key) ?? NaN;
    return out;
  }, [bars, activeTrack]);

  const onBarSelect = useCallback(
    (bar: ConformerBar) => {
      if (!aTable) return;
      const info: PickInfo = { chainId: bar.chain, authSeqId: bar.seq, compId: bar.compId, altId: "", insCode: bar.ins };
      const c = residueCentroid(aTable, info);
      setPicked({ ...info, position3d: c ?? undefined });
      setSelRange(null);
      setPopup(null);
    },
    [aTable],
  );

  // A barplot drag becomes the selection AND the metric scope in one gesture.
  const onBarRangeSelect = useCallback((range: ResidueRange) => {
    setSelRange(range);
    setPicked(null);
    setPopup(null);
    setScopeMode("range");
    setRangeChain(range.chain);
    setRangeFrom(String(range.from));
    setRangeTo(String(range.to));
  }, []);

  const onBarHover = useCallback(
    (bar: ConformerBar | null) => {
      if (!viewer) return;
      if (!bar) {
        viewer.highlightLoci(null);
        return;
      }
      const structure = viewer.getCurrentStructure();
      if (!structure) return;
      viewer.highlightLoci(executeQuery(buildResidueQuery(bar.chain, bar.seq), structure));
    },
    [viewer],
  );

  const onPrimaryLoaded = useCallback(() => setPrimaryLoaded(true), []);
  const ready = densityState === "ready";
  const hoverBarKey = hoverInfo
    ? residueIdKey({ chain: hoverInfo.chainId, seq: hoverInfo.authSeqId, ins: hoverInfo.insCode })
    : null;

  const popupTarget: ActionTarget | null = !popup
    ? null
    : popup.range
      ? selRange && rangeInfo
        ? {
            kind: "range",
            chain: selRange.chain,
            from: selRange.from,
            to: selRange.to,
            residueCount: rangeInfo.residueCount,
            splitCount: rangeInfo.splitKeys.length,
            letters: rangeInfo.letters,
          }
        : null
      : picked
        ? { kind: "residue", pick: picked, altIds: pickedAltIds }
        : null;
  // a fresh range popup opens with the sphere that just encloses the range
  const popupClipRadius =
    clip?.radius ??
    (popupIsRange && rangeInfo?.stats
      ? Math.min(40, Math.max(5, Math.ceil(rangeInfo.stats.fitRadius)))
      : DEFAULT_CLIP_RADIUS);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-white text-[12px] text-neutral-700">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-3">
          <LoaderPanel
            entryInput={entryInput}
            onEntryInput={setEntryInput}
            onLoad={() => startLoad(entryInput)}
            loading={loading}
            currentEntry={entry}
            stages={stages}
            provenance={provenance}
            error={loadError}
            showRetryDensity={densityState === "error"}
            onRetryDensity={retryDensity}
          />
          <ConformerStatesPanel
            letters={stateLetters}
            active={globalAlt}
            disabled={!primaryLoaded}
            onChange={setGlobalAlt}
          />
          <SelectionPanel
            aTable={aTable}
            picked={picked}
            conformerCount={pickedConformerCount}
            conformersShown={pickedShown}
            densitySampler={densitySampler}
            fofcSampler={fofcSampler}
          />
        </aside>

        <div className="relative min-w-0 flex-1" onContextMenu={(e) => e.preventDefault()}>
          <MolstarViewer data={aText} binary={false} view={VIEW} variant="lab" onReady={setViewer} onLoaded={onPrimaryLoaded} />
          <StyleTray
            ready={primaryLoaded}
            densityReady={ready}
            densityBusy={densityBusy}
            showDensity={showDensity}
            onShowDensity={setShowDensity}
            style={repStyle}
            onStyle={setRepStyle}
            densityQuality={densityQuality}
            onDensityQuality={changeDensityQuality}
          />
          {hoverInfo && (
            <div className="pointer-events-none absolute bottom-2 left-2 rounded border border-neutral-200 bg-white/85 px-1.5 py-0.5 text-[11px] text-neutral-600">
              {hoverInfo.compId} {hoverInfo.chainId}/{hoverInfo.authSeqId}
              {hoverInfo.altId ? ` alt ${hoverInfo.altId}` : ""}
            </div>
          )}
          {popup && popupTarget && (
            <SelectionActionsPopup
              anchor={popup}
              target={popupTarget}
              conformersShown={popupShown}
              densityReady={ready}
              clipMode={clip ? (clip.includeModel ? "all" : "density") : "off"}
              clipRadius={popupClipRadius}
              onToggleConformers={togglePopupConformers}
              onClip={applyClip}
              onSetScope={() => {
                if (popupTarget.kind === "range") {
                  setScopeMode("range");
                  setRangeChain(popupTarget.chain);
                  setRangeFrom(String(popupTarget.from));
                  setRangeTo(String(popupTarget.to));
                } else {
                  setScopeMode("residue");
                }
                setPopup(null);
              }}
              onClose={() => setPopup(null)}
            />
          )}
        </div>

        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-neutral-200 bg-neutral-50 p-3">
          <DensityControls
            ready={ready}
            show2fofc={show2fofc}
            onShow2fofc={setShow2fofc}
            sigma={sigma}
            onSigma={setSigma}
            showFofc={showFofc}
            onShowFofc={setShowFofc}
            opacity={densityOpacity}
            onOpacity={setDensityOpacity}
            showB={showB}
            bAvailable={!!secondaryRef}
            onShowB={setShowB}
          />
          <MetricsToolbar
            metricId={metricId}
            onMetricId={setMetricId}
            densityReady={ready}
            hasB={!!bTable}
            provenance={{
              aUrl: entry?.qfit.url ?? "model A file",
              bUrl: entry?.deposited.url ?? "model B file",
              sfUrl: entry?.sf.url ?? "the entry's sf-cif",
              aDesc: "qFit multiconformer",
              bDesc: "deposited",
            }}
            scopeMode={scopeMode}
            onScopeMode={setScopeMode}
            picked={picked}
            rangeChain={rangeChain}
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
            onRangeChain={setRangeChain}
            onRangeFrom={setRangeFrom}
            onRangeTo={setRangeTo}
            projectedDomain={projected?.domain ?? null}
            status={status}
          />
        </aside>
      </div>

      <div className="flex shrink-0 items-start gap-4 border-t border-neutral-200 bg-neutral-50 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <SectionLabel>Conformers per residue</SectionLabel>
            {(picked || selRange) && (
              <span className="flex items-center gap-1 rounded border border-sky-800/30 bg-sky-50 px-1.5 py-px text-[10.5px] tabular-nums text-sky-900">
                {picked
                  ? `${picked.compId} ${picked.chainId}/${picked.authSeqId}`
                  : `${selRange!.chain} ${selRange!.from}–${selRange!.to}`}
                <button
                  type="button"
                  title="clear selection"
                  onClick={clearSelection}
                  className="ml-0.5 leading-none text-sky-900/60 hover:text-sky-900"
                >
                  {"×"}
                </button>
              </span>
            )}
          </div>
          <ConformerBarplot
            bars={bars?.list ?? null}
            maxCount={bars?.maxCount ?? 2}
            selectedKey={pickedKey}
            selectedRange={selRange}
            hoverKey={hoverBarKey}
            metricValues={laneValues}
            metricDomain={activeTrack?.track.domain ?? null}
            metricColors={activeTrack ? METRIC_UI[activeTrack.id].colors : null}
            metricName={activeTrack ? metricLabel(activeTrack.id) : null}
            metricUnit={activeTrack ? metricUnit(activeTrack.id) : null}
            onHover={onBarHover}
            onSelect={onBarSelect}
            onRangeSelect={onBarRangeSelect}
          />
        </div>
        <div className="flex w-[380px] shrink-0 flex-col gap-1 border-l border-neutral-200 pl-4">
          <div className="flex items-center justify-between">
            <SectionLabel>Slice</SectionLabel>
            <div className="flex items-center gap-3 text-[11px] text-neutral-600">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={slice3d} disabled={!ready} onChange={(e) => setSlice3d(e.target.checked)} />
                <span>plane in 3D</span>
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={sliceModel}
                  disabled={!ready}
                  onChange={(e) => setSliceModel(e.target.checked)}
                />
                <span>slice model</span>
              </label>
            </div>
          </div>
          <SlicePanel
            box={box}
            densitySampler={densitySampler}
            metricSampler={metricSampler}
            metricDomain={projected?.domain ?? null}
            metricColors={projected ? METRIC_UI[projected.id].colors : null}
            metricLabel={projected ? metricLabel(projected.id) : null}
            onPlaneChange={onPlaneChange}
          />
        </div>
      </div>
    </div>
  );
}
