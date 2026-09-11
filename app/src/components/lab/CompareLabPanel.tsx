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
import { residueLoci } from "@/lib/molstar/queries";
import SlicePanel, { slicePlaneFor, type SliceAxis, type SlicePlane } from "@/components/lab/SlicePanel";
import DensityFlyout from "@/components/lab/compare/DensityFlyout";
import EntryCard from "@/components/lab/compare/EntryCard";
import EntryChip from "@/components/lab/compare/EntryChip";
import SelectionActionsPopup, { type ActionTarget, type ClipMode } from "@/components/lab/compare/SelectionActionsPopup";
import SelectionFlyout, { type RangeSummary } from "@/components/lab/compare/SelectionFlyout";
import SliceControls from "@/components/lab/compare/SliceControls";
import StyleTray from "@/components/lab/compare/StyleTray";
import SequenceLanes, { type LaneContextTarget } from "@/components/lab/lanes/SequenceLanes";
import { makeMetricLane } from "@/components/lab/lanes/PlotLanes";
import type { LaneMetric } from "@/components/lab/lanes/types";
import { fetchPdbeAnnotations, mapAnnotations, type AnnotationsBySource, type PdbeRaw } from "@/lib/annotations/pdbe";
import { METRIC_ORDER, METRIC_UI, metricLabel, metricUnit, type MetricId } from "@/components/lab/compare/metrics";
import { WATER_COMPS, type ProvenanceRecord, type StageId, type StageState } from "@/lib/lab/entries";
import { pickPair, ROLE_LABELS, type EntryManifest, type ManifestModel } from "@/lib/dpdb/types";
import { resolveEntry } from "@/lib/dpdb/resolve";
import { toFetchableUrl } from "@/lib/dpdb/client";
import {
  buildAtomTable,
  buildSequenceModel,
  describeEntry,
  parseCifText,
  readSecondaryStructure,
  residueKey,
  summarizeAltlocs,
  summarizeEnsemble,
  type AtomTable,
  type MolCifFile,
  type ResidueRef,
} from "@dynamic-pdb/hetkit/model";
import {
  altlocRmsf,
  bIsoMean,
  conformerCount,
  ensembleRmsf,
  mapSupportDelta,
  mapValueTracks,
  METRICS,
  modelRmsd,
  occupancyEntropy,
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
// structure-factor downloads above this ask before fetching (PanDDA deposits run to hundreds of MB)
const SF_CONFIRM_MB = 50;

function initialStages(): Record<StageId, StageState> {
  return {
    catalogue: "pending",
    models: "pending",
    tables: "pending",
    "sf-fetch": "pending",
    fft: "pending",
    carve: "pending",
    iso: "pending",
  };
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

// provenance prose for a model: the bundled rows bring their own; catalogue models get what
// the artifact record says about them
function describeModel(m: ManifestModel): string {
  if (m.note) return m.note;
  const bits = [ROLE_LABELS[m.role], m.format ?? "unknown format"];
  if (m.sizeBytes != null) bits.push(`${(m.sizeBytes / 1e6).toFixed(2)} MB`);
  if (m.sha256) bits.push(`sha256 ${m.sha256.slice(0, 12)}`);
  if (m.software) bits.push(m.software);
  return `${m.title} from the Dynamic PDB catalogue (${bits.join(", ")})`;
}

export default function CompareLabPanel() {
  const [viewer, setViewer] = useState<ViewerInstance | null>(null);

  // --- loader / entry state ---
  const [entryInput, setEntryInput] = useState(DEFAULT_ENTRY);
  const [entry, setEntry] = useState<EntryManifest | null>(null);
  // the A/B pair; startLoad only sets an entry pickPair already accepted, so this cannot throw
  const pair = useMemo(() => (entry ? pickPair(entry) : null), [entry]);
  const [loading, setLoading] = useState(false);
  const [stages, setStages] = useState<Record<StageId, StageState>>(initialStages());
  const [provenance, setProvenance] = useState<ProvenanceRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [aText, setAText] = useState<string | null>(null);
  const [bText, setBText] = useState<string | null>(null);
  const [aTable, setATable] = useState<AtomTable | null>(null);
  const [bTable, setBTable] = useState<AtomTable | null>(null);
  // the parsed files stay around: the sequence bridge reads the polymer scheme and the
  // secondary structure, categories the atom tables do not carry
  const [aFile, setAFile] = useState<MolCifFile | null>(null);
  const [bFile, setBFile] = useState<MolCifFile | null>(null);
  const [primaryLoaded, setPrimaryLoaded] = useState(false);
  const [secondaryRef, setSecondaryRef] = useState<string | null>(null);
  const [showB, setShowB] = useState(false);
  // which MODEL frame of a multi-model (ensemble) model A is on screen
  const [memberIndex, setMemberIndex] = useState(0);

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

  // --- PDBe annotations (lanes) ---
  const [pdbeRaw, setPdbeRaw] = useState<PdbeRaw | "loading" | null>(null);

  // --- metric ---
  const [metricId, setMetricId] = useState<MetricId | "none">("none");
  const [projected, setProjected] = useState<{ id: MetricId; domain: [number, number] } | null>(null);
  const [projVersion, setProjVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  // --- layout: height of the resizable lanes strip ---
  const [lanesHeight, setLanesHeight] = useState(260);

  // --- slice ---
  const [slice3d, setSlice3d] = useState(false);
  const [sliceModel, setSliceModel] = useState(false);
  const [sliceAxis, setSliceAxis] = useState<SliceAxis>(2);
  const [sliceFrac, setSliceFrac] = useState(0.5);
  // the optional 2D image of the plane (style flyout); the plane exists regardless
  const [showSlice2d, setShowSlice2d] = useState(false);
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
  const closePopup = useCallback(() => setPopup(null), []);

  // --- load flow: entry -> model files -> tables (density chains in its own effect) ---

  const startLoad = useCallback(
    (id: string) => {
      setLoadError(null);
      setEntry(null);
      setLoading(true);

      // reset everything scene-derived; setting new texts clears the Mol* state tree
      setPrimaryLoaded(false);
      setSecondaryRef(null);
      setMemberIndex(0);
      setAText(null);
      setBText(null);
      setATable(null);
      setBTable(null);
      setAFile(null);
      setBFile(null);
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
      setStages({ ...initialStages(), catalogue: "active" });

      void (async () => {
        try {
          const manifest = await resolveEntry(id);
          const { a, b } = pickPair(manifest);
          setEntry(manifest);
          setEntryInput(manifest.pdbId);
          setStage("catalogue", "done");
          setStage("models", "active");
          const [aT, bT] = await Promise.all([
            fetchText(toFetchableUrl(a.url)),
            b ? fetchText(toFetchableUrl(b.url)) : Promise.resolve(null),
          ]);
          setStage("models", "done");
          setProvenance([
            { role: "model A", desc: describeModel(a), url: a.url },
            ...(b ? [{ role: "model B" as const, desc: describeModel(b), url: b.url }] : []),
          ]);
          setAText(aT);
          setBText(bT);
          setStage("tables", "active");
          const fA = await parseCifText(aT);
          const fB = bT ? await parseCifText(bT) : null;
          setAFile(fA);
          setBFile(fB);
          setATable(buildAtomTable(fA));
          setBTable(fB ? buildAtomTable(fB) : null);
          setStage("tables", "done");
        } catch (e) {
          setStages((prev) => {
            const next = { ...prev };
            if (next.catalogue === "active") next.catalogue = "error";
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
    if (!viewer || !primaryLoaded || !bText || !entry || !pair?.b || secondaryRef || secondaryBusyRef.current) return;
    secondaryBusyRef.current = true;
    viewer
      .loadSecondary(bText, { label: `${entry.pdbId} ${pair.b.title}`, color: GHOST_B_COLOR })
      .then((ref) => setSecondaryRef(ref))
      .catch((e) => setLoadError(`model B failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        secondaryBusyRef.current = false;
      });
  }, [viewer, primaryLoaded, bText, entry, pair, secondaryRef]);

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
    // memberIndex: a frame scrub rebuilds the structure in place, dropping the layers
  }, [viewer, primaryLoaded, confPlan, shownConformers, globalAlt, memberIndex, runStyling]);

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
      const loci = selRange
        ? residueLoci(structure, selRange.chain, selRange.from, selRange.to)
        : picked
          ? residueLoci(structure, picked.chainId, picked.authSeqId)
          : null;
      if (loci) viewer.setSelection(loci);
      else viewer.clearSelection();
    });
    // memberIndex: the selection marker must re-assert on the rebuilt frame
  }, [viewer, primaryLoaded, picked, selRange, repStyle, shownConformers, globalAlt, confPlan, memberIndex, runStyling]);

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
    const sf = entry?.sf ?? null; // null: a map-less entry (NMR ensemble) — no density lab
    if (!ctx || !entry || !sf || !primaryLoaded || !aTable) return;
    if (pair?.b && !secondaryRef) return; // wait for the ghost only when the entry HAS a B
    if (densityState !== "idle" || densityRunRef.current === entry.id) return;
    densityRunRef.current = entry.id;
    setDensityState("loading");
    // an entry switch (or retry) rewrites densityRunRef; a stale in-flight run must stop
    // touching state that now belongs to the new entry
    const stale = () => densityRunRef.current !== entry.id;
    void (async () => {
      try {
        setStage("sf-fetch", "active");
        const mb = sf.sizeBytes != null ? sf.sizeBytes / 1e6 : null;
        if (mb != null && mb > SF_CONFIRM_MB && !window.confirm(`${entry.pdbId} structure factors are ~${mb.toFixed(0)} MB. Download anyway?`)) {
          throw new Error(`structure factors skipped (~${mb.toFixed(0)} MB); "retry density" asks again`);
        }
        const text = await fetchText(toFetchableUrl(sf.url));
        if (stale()) return;
        setStage("sf-fetch", "done");
        setProvenance((prev) => [
          ...prev.filter((p) => p.role !== "structure factors" && p.role !== "maps"),
          {
            role: "structure factors",
            desc: `${sf.note} (${mb != null ? `~${mb.toFixed(1)} MB` : "size unknown"})`,
            url: sf.url,
          },
        ]);
        setStage("fft", "active");
        const vols = await loadStructureFactors(ctx, text, { entryId: entry.pdbId, label: `${entry.pdbId}-sf` });
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
  }, [viewer, entry, pair, primaryLoaded, secondaryRef, aTable, densityState, setStage]);

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

  // --- ensemble members: one AtomTable per MODEL frame of model A ---

  const ensembleInfo = useMemo(() => (aFile ? summarizeEnsemble(aFile) : null), [aFile]);
  const memberTables = useMemo<AtomTable[]>(() => {
    if (!aFile || !ensembleInfo) return [];
    const out: AtomTable[] = [];
    for (const n of ensembleInfo.modelNums) {
      const t = buildAtomTable(aFile, { modelNum: n });
      if (t) out.push(t);
    }
    return out;
  }, [aFile, ensembleInfo]);

  // switch the visible member: Mol* scrubs the frame in place (setModelIndex), and the
  // atom-table swap recomputes everything downstream — altlocs, lanes, metrics, the
  // selection support table
  const setMember = useCallback(
    (i: number) => {
      if (!memberTables.length) return;
      const clamped = Math.max(0, Math.min(memberTables.length - 1, i));
      setMemberIndex(clamped);
      if (viewer) void viewer.setModelIndex(clamped);
      setATable(memberTables[clamped]);
    },
    [memberTables, viewer],
  );

  // --- metric computation + projection onto the 2Fo-Fc surface ---

  const computeBaseTrack = useCallback(
    (id: MetricId): Track | null => {
      if (!aTable) return null;
      const ctx = viewer?.ctx; // only the map metrics need the plugin (for the samplers)
      switch (id) {
        case "conformer-count":
          return conformerCount(aTable);
        case "occupancy-entropy":
          return occupancyEntropy(aTable);
        case "b-iso-mean":
          return bIsoMean(aTable);
        case "ensemble-rmsf":
          return memberTables.length >= 2 ? ensembleRmsf(memberTables) : null;
        case "model-rmsd":
          return bTable ? modelRmsd(aTable, bTable) : null;
        case "altloc-rmsf-delta":
          return bTable ? trackDelta(altlocRmsf(aTable), altlocRmsf(bTable), { metricId: "altloc-rmsf-delta" }) : null;
        case "fofc-mean":
        case "fofc-peak": {
          if (!ctx) return null;
          const s = samplerForVolume(ctx, volsRef.current?.foFc ?? null, { relative: true });
          if (!s) return null;
          const tracks = mapValueTracks(aTable, s, { idPrefix: "fofc" });
          return id === "fofc-mean" ? tracks.mean : tracks.peak;
        }
        case "support-delta": {
          if (!ctx) return null;
          const s = samplerForVolume(ctx, volsRef.current?.twoFoFc ?? null, { relative: true });
          return s && bTable ? mapSupportDelta(aTable, bTable, s) : null;
        }
      }
    },
    [viewer, aTable, bTable, memberTables],
  );

  // Every metric whose inputs are ready, as a whole-model track keyed for the lanes;
  // a string is the reason the metric cannot be computed yet (shown in the lanes drawer).
  // The 3D projection below draws from the same map, so lane and surface always agree.
  const laneMetrics = useMemo<Map<string, LaneMetric | string>>(() => {
    const out = new Map<string, LaneMetric | string>();
    if (!aTable) return out;
    for (const id of METRIC_ORDER) {
      const ui = METRIC_UI[id];
      if (ui.pair && !bTable) {
        out.set(id, "needs model B");
        continue;
      }
      if (ui.ensemble && memberTables.length < 2) {
        out.set(id, "needs a multi-model ensemble");
        continue;
      }
      if (ui.map && densityState !== "ready") {
        out.set(id, "enables with the density");
        continue;
      }
      const track = computeBaseTrack(id);
      if (!track) {
        out.set(id, "unavailable");
        continue;
      }
      out.set(id, {
        id,
        name: metricLabel(id),
        unit: metricUnit(id) || null,
        colors: ui.colors,
        domain: ui.sequential ? [0, track.domain[1]] : track.domain,
        track,
      });
    }
    return out;
    // densityVersion: the map samplers read volsRef, refreshed when the maps rebuild
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aTable, bTable, memberTables, densityState, densityVersion, computeBaseTrack]);

  const metricLaneModules = useMemo(
    () => METRIC_ORDER.map((id) => makeMetricLane(id, metricLabel(id), METRICS.get(id)?.description ?? "")),
    [],
  );

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !aTable) return;
    const r = reprsRef.current;
    if (metricId === "none") {
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
    if (densityState !== "ready" || !r?.twoFoFc) return; // the projection target is the 2Fo-Fc surface
    const m = laneMetrics.get(metricId);
    if (!m || typeof m === "string") return;
    const ui = METRIC_UI[metricId];
    const t = setTimeout(() => {
      let points = trackToPoints(aTable, m.track);
      if (ui.unionSplat && bTable) points = points.concat(trackToPoints(bTable, m.track));
      if (!points.length) return;
      runProjection(async () => {
        await projectorRef.current.project(ctx, {
          points,
          targets: [r.twoFoFc],
          domain: m.domain,
          colors: ui.colors,
          label: metricLabel(metricId),
        });
        setProjected({ id: metricId, domain: m.domain });
        setProjVersion((v) => v + 1);
        setStatus(`${metricLabel(metricId)}: projected from ${points.length} atoms`);
      });
    }, 120);
    return () => clearTimeout(t);
  }, [viewer, aTable, bTable, metricId, densityState, densityVersion, laneMetrics, runProjection]);

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

  // The plane is parent state (normal axis + position through the model box), so it exists
  // whether or not the 2D map is shown. The ref is written synchronously for the effects
  // that read it in the same commit; the version bump and the in-scene slice update are
  // debounced against slider drags, as before.
  const slicePlane = useMemo(
    () => (box ? slicePlaneFor(box, sliceAxis, sliceFrac) : null),
    [box, sliceAxis, sliceFrac],
  );

  useEffect(() => {
    planeRef.current = slicePlane;
    if (!slicePlane) return;
    const timer = setTimeout(() => {
      setPlaneVersion((v) => v + 1);
      const ctx = viewer?.ctx;
      if (ctx && slice3dNodeRef.current) {
        void updateSlice(ctx, slice3dNodeRef.current, slicePlane.point, slicePlane.normal);
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [slicePlane, viewer]);

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
    // planeVersion: after an entry switch planeRef is null until the new box yields a plane;
    // the bump retries the create once a plane exists again.
  }, [viewer, slice3d, densityState, planeVersion]);

  // --- selection helpers (popup + barplot) ---

  const pickedKey = picked ? residueIdKey({ chain: picked.chainId, seq: picked.authSeqId, ins: picked.insCode }) : null;
  const pickedAltIds = pickedKey ? (confPlan.byKey.get(pickedKey)?.altIds ?? []) : [];
  const pickedConformerCount = pickedKey ? (pickedAltIds.length || 1) : null;
  const pickedShown = !!(pickedKey && shownConformers.has(pickedKey));

  // aggregates of the current range selection: what the range-mode actions panel acts
  // on, plus the occupancy/heterogeneity summary the selection flyout reports
  const rangeInfo = useMemo(() => {
    if (!aTable || !selRange) return null;
    const splitKeys: string[] = [];
    const letters = new Set<string>();
    const histogram = new Map<number, number>();
    let residueCount = 0;
    let bSum = 0, bN = 0, occSum = 0, occN = 0;
    for (const res of aTable.residues) {
      if (WATER_COMPS.has(res.compId)) continue;
      if (res.ref.chain !== selRange.chain || res.ref.seq < selRange.from || res.ref.seq > selRange.to) continue;
      residueCount++;
      const key = residueKey(res.ref);
      const alt = confPlan.byKey.get(key);
      const nConf = alt?.altIds.length || 1;
      histogram.set(nConf, (histogram.get(nConf) ?? 0) + 1);
      if (alt && alt.altIds.length > 1) {
        splitKeys.push(key);
        for (const l of alt.altIds) letters.add(l);
      }
      for (const r of res.rows) {
        const e = aTable.element[r];
        if (e === "H" || e === "D") continue;
        const b = aTable.bIso[r];
        if (!Number.isNaN(b)) { bSum += b; bN++; }
        if (aTable.altId[r]) { occSum += aTable.occupancy[r]; occN++; }
      }
    }
    return {
      residueCount,
      splitKeys,
      letters: [...letters].sort(),
      stats: rangeStats(aTable, selRange),
      histogram: [...histogram.entries()].sort((a, b) => a[0] - b[0]) as [number, number][],
      meanAltOcc: occN ? occSum / occN : null,
      meanB: bN ? bSum / bN : null,
    };
  }, [aTable, selRange, confPlan]);

  const rangeSummary = useMemo<RangeSummary | null>(
    () =>
      selRange && rangeInfo
        ? {
            chain: selRange.chain,
            from: selRange.from,
            to: selRange.to,
            residueCount: rangeInfo.residueCount,
            splitCount: rangeInfo.splitKeys.length,
            histogram: rangeInfo.histogram,
            meanAltOcc: rangeInfo.meanAltOcc,
            meanB: rangeInfo.meanB,
          }
        : null,
    [selRange, rangeInfo],
  );

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
  }, []);

  // every altloc letter of model A, with how many residues carry it (the state buttons)
  const stateLetters = useMemo(() => {
    if (!altSummary) return [];
    return altSummary.altIds.map((letter) => ({
      letter,
      residueCount: altSummary.residues.filter((r) => r.altIds.includes(letter)).length,
    }));
  }, [altSummary]);

  // --- sequence lanes: the structure-sequence bridge ---
  // The deposited file carries the polymer scheme (SEQRES with author numbering) and the
  // secondary-structure records; qFit output has neither. So model B frames model A
  // whenever it is there, and A's observed residues frame themselves otherwise. Lanes
  // speak positions; everything that leaves them is an author-keyed residue or range.
  const seqModel = useMemo(
    () => (aTable && aFile ? buildSequenceModel(bFile ?? aFile, aTable) : null),
    [aTable, aFile, bFile],
  );
  const secondaryByChain = useMemo(
    () => (seqModel && aFile ? readSecondaryStructure(bFile ?? aFile, seqModel) : null),
    [seqModel, aFile, bFile],
  );
  const laneHoverRef = useMemo<ResidueRef | null>(
    () => (hoverInfo ? { chain: hoverInfo.chainId, seq: hoverInfo.authSeqId, ins: hoverInfo.insCode } : null),
    [hoverInfo],
  );
  const laneSelection = useMemo<ResidueRange | null>(
    () => selRange ?? (picked ? { chain: picked.chainId, from: picked.authSeqId, to: picked.authSeqId } : null),
    [selRange, picked],
  );

  // entry-level facts from the deposited CIF header (model A's own header as fallback)
  const entryDesc = useMemo(() => {
    const f = bFile ?? aFile;
    return f ? describeEntry(f) : null;
  }, [aFile, bFile]);

  // PDBe annotations, one fetch per entry with a real wwPDB id (direct: the API sends
  // open CORS); conversion to lane coordinates waits for the sequence bridge
  useEffect(() => {
    const pdbId = entry?.pdbId;
    if (!pdbId || !/^[0-9][A-Za-z0-9]{3}$/.test(pdbId)) {
      setPdbeRaw(null);
      return;
    }
    let stale = false;
    setPdbeRaw("loading");
    void fetchPdbeAnnotations(pdbId).then((raw) => {
      if (!stale) setPdbeRaw(raw);
    });
    return () => {
      stale = true;
    };
  }, [entry]);

  const annotations = useMemo<AnnotationsBySource | "loading" | null>(() => {
    if (pdbeRaw === null || pdbeRaw === "loading") return pdbeRaw;
    if (!seqModel) return "loading";
    return mapAnnotations(pdbeRaw, seqModel);
  }, [pdbeRaw, seqModel]);

  // an author-keyed lane residue as a PickInfo, centroid included (what a 3D pick carries)
  const pickFromRef = useCallback(
    (ref: ResidueRef): PickInfo | null => {
      if (!aTable) return null;
      const res = aTable.residues.find((r) => r.ref.chain === ref.chain && r.ref.seq === ref.seq);
      if (!res) return null;
      const info: PickInfo = { chainId: res.ref.chain, authSeqId: res.ref.seq, compId: res.compId, altId: "", insCode: res.ref.ins };
      const c = residueCentroid(aTable, info);
      return { ...info, position3d: c ?? undefined };
    },
    [aTable],
  );

  // a single residue becomes the pick (3D selection marker + actions panel target); a
  // drag becomes the range selection
  const onLaneSelect = useCallback(
    (range: ResidueRange) => {
      if (range.from === range.to) {
        const info = pickFromRef({ chain: range.chain, seq: range.from, ins: "" });
        if (info) {
          setPicked(info);
          setSelRange(null);
          setPopup(null);
          return;
        }
      }
      setSelRange(range);
      setPicked(null);
      setPopup(null);
    },
    [pickFromRef],
  );

  // right click in the lanes opens the same actions popup as a right click in 3D
  const onLaneContext = useCallback(
    (target: LaneContextTarget, anchor: { x: number; y: number }) => {
      if (target.kind === "range") {
        // only emitted for the live multi-residue selection: selRange already holds it
        setPopup({ x: anchor.x, y: anchor.y, range: true });
        return;
      }
      const info = pickFromRef(target.ref);
      if (!info) return;
      setPicked(info);
      setSelRange(null);
      setPopup({ x: anchor.x, y: anchor.y, range: false });
    },
    [pickFromRef],
  );

  // rAF-throttled: lane hover arrives at pointer rate; Mol*'s mark + redraw should run
  // at most once per frame, on the latest residue.
  const laneHoverRafRef = useRef<number | null>(null);
  const laneHoverPendingRef = useRef<ResidueRef | null>(null);
  const onLaneHover = useCallback(
    (ref: ResidueRef | null) => {
      if (!viewer) return;
      laneHoverPendingRef.current = ref;
      if (laneHoverRafRef.current !== null) return;
      laneHoverRafRef.current = requestAnimationFrame(() => {
        laneHoverRafRef.current = null;
        const r = laneHoverPendingRef.current;
        if (!r) {
          viewer.highlightLoci(null);
          return;
        }
        const structure = viewer.getCurrentStructure();
        if (!structure) return;
        viewer.highlightLoci(residueLoci(structure, r.chain, r.seq));
      });
    },
    [viewer],
  );

  const onPrimaryLoaded = useCallback(() => setPrimaryLoaded(true), []);
  const ready = densityState === "ready";

  // drag the divider above the lanes strip to trade viewer height for lane height
  const startLanesResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = lanesHeight;
      const onMove = (ev: MouseEvent) => {
        const h = startH + (startY - ev.clientY);
        setLanesHeight(Math.round(Math.min(window.innerHeight * 0.6, Math.max(96, h))));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [lanesHeight],
  );

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

  // the two parent-built tray flyouts (state stays here; StyleTray only positions them)
  const densityFlyout = (
    <DensityFlyout
      metricId={metricId}
      onMetricId={setMetricId}
      densityReady={ready}
      densityBusy={densityBusy}
      hasB={!!bTable}
      provenance={{
        aUrl: pair?.a.url ?? "model A file",
        bUrl: pair?.b?.url ?? "model B file",
        sfUrl: entry?.sf?.url ?? "the entry's sf-cif",
        aDesc: pair ? ROLE_LABELS[pair.a.role] : "model A",
        bDesc: pair?.b ? ROLE_LABELS[pair.b.role] : "model B",
      }}
      projectedDomain={projected?.domain ?? null}
      status={status}
      hasEnsemble={memberTables.length >= 2}
      show2fofc={show2fofc}
      onShow2fofc={setShow2fofc}
      sigma={sigma}
      onSigma={setSigma}
      showFofc={showFofc}
      onShowFofc={setShowFofc}
      opacity={densityOpacity}
      onOpacity={setDensityOpacity}
      densityQuality={densityQuality}
      onDensityQuality={changeDensityQuality}
      showSlice2d={showSlice2d}
      onShowSlice2d={setShowSlice2d}
    />
  );
  const selectionFlyout = (
    <SelectionFlyout
      aTable={aTable}
      picked={picked}
      conformerCount={pickedConformerCount}
      conformersShown={pickedShown}
      densitySampler={densitySampler}
      fofcSampler={fofcSampler}
      selRange={selRange}
      rangeSummary={rangeSummary}
      stateLetters={stateLetters}
      globalAlt={globalAlt}
      onGlobalAlt={setGlobalAlt}
      primaryLoaded={primaryLoaded}
      memberNums={ensembleInfo?.modelNums ?? []}
      memberIndex={memberIndex}
      onMember={setMember}
    />
  );

  return (
    <div className="flex h-screen min-h-0 flex-col bg-white text-[12px] text-ink-secondary">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface-muted p-3">
          <EntryCard
            entry={entry}
            desc={entryDesc}
            aTable={aTable}
            altSummary={altSummary}
            memberCount={memberTables.length}
          />
        </aside>

        <div className="relative min-w-0 flex-1" onContextMenu={(e) => e.preventDefault()}>
          <MolstarViewer data={aText} binary={false} view={VIEW} variant="lab" onReady={setViewer} onLoaded={onPrimaryLoaded} />
          <div className="absolute right-2 top-2 z-10 flex items-start gap-1.5">
            <EntryChip
              entry={entry}
              entryInput={entryInput}
              onEntryInput={setEntryInput}
              onLoad={() => startLoad(entryInput)}
              loading={loading}
              stages={stages}
              provenance={provenance}
              error={loadError}
              showRetryDensity={densityState === "error"}
              onRetryDensity={retryDensity}
            />
            <StyleTray
              ready={primaryLoaded}
              densityReady={ready}
              showDensity={showDensity}
              onShowDensity={setShowDensity}
              style={repStyle}
              onStyle={setRepStyle}
              showB={showB}
              bAvailable={!!secondaryRef}
              onShowB={setShowB}
              densityFlyout={densityFlyout}
              selectionFlyout={selectionFlyout}
            />
          </div>
          {hoverInfo && (
            <div className="pointer-events-none absolute bottom-2 left-2 rounded border border-line bg-white/85 px-1.5 py-0.5 text-[11px] text-ink-secondary">
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
              onClose={closePopup}
            />
          )}
        </div>

      </div>

      <div
        className="h-1.5 shrink-0 cursor-row-resize border-t border-line bg-surface-muted hover:bg-accent/30"
        onMouseDown={startLanesResize}
      />
      <div className="flex shrink-0 items-start gap-4 overflow-hidden bg-white px-3 py-2" style={{ height: lanesHeight }}>
        <div className="flex h-full min-w-0 flex-1 flex-col gap-1 overflow-y-auto">
          <SequenceLanes
            model={seqModel}
            aTable={aTable}
            confPlan={confPlan}
            secondaryByChain={secondaryByChain}
            metrics={laneMetrics}
            annotations={annotations}
            metricLanes={metricLaneModules}
            hoverRef={laneHoverRef}
            selection={laneSelection}
            onHover={onLaneHover}
            onSelect={onLaneSelect}
            onContext={onLaneContext}
            leading={
              <>
                <span className="text-[11px] font-medium text-ink-muted">Sequence</span>
                {(picked || selRange) && (
                  <span className="flex items-center gap-1 rounded border border-accent/30 bg-accent-soft px-1.5 py-px text-[10.5px] tabular-nums text-accent">
                    {picked
                      ? `${picked.compId} ${picked.chainId}/${picked.authSeqId}`
                      : `${selRange!.chain} ${selRange!.from}–${selRange!.to}`}
                    <button
                      type="button"
                      title="clear selection"
                      onClick={clearSelection}
                      className="ml-0.5 leading-none text-accent/60 hover:text-accent"
                    >
                      {"×"}
                    </button>
                  </span>
                )}
              </>
            }
          />
        </div>
        <div className="flex h-full w-[380px] shrink-0 flex-col gap-1.5 overflow-y-auto border-l border-line pl-4">
          <SliceControls
            ready={ready}
            slice3d={slice3d}
            onSlice3d={setSlice3d}
            sliceModel={sliceModel}
            onSliceModel={setSliceModel}
            axis={sliceAxis}
            onAxis={setSliceAxis}
            frac={sliceFrac}
            onFrac={setSliceFrac}
            coord={slicePlane?.point[sliceAxis] ?? null}
          />
          {showSlice2d && (
            <SlicePanel
              box={box}
              axis={sliceAxis}
              frac={sliceFrac}
              densitySampler={densitySampler}
              metricSampler={metricSampler}
              metricDomain={projected?.domain ?? null}
              metricColors={projected ? METRIC_UI[projected.id].colors : null}
              metricLabel={projected ? metricLabel(projected.id) : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
