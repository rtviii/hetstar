"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MolstarViewer from "./components/MolstarViewer";
import type { MolstarViewer as ViewerInstance, PickInfo } from "./lib/molstar/viewer";
import { GHOST_B_COLOR, MODEL_A_COLOR, type StructureView } from "./lib/molstar/style";
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
  type ClipObjectSpec,
  type DensityQuality,
  type DensityReprs,
  type DensityVolumes,
} from "./lib/molstar/density";
import { CARVE_RADIUS, carveDensityToStructure } from "./lib/molstar/carve";
import {
  applyRepStyle,
  compSplitFromTable,
  DEFAULT_REP_STYLE,
  ensureLabComponents,
  reprSpecForRole,
  SELREP_BALLSTICK_SIZE,
  SELREP_SPACEFILL_SIZE,
  type CompSplit,
  type RepStyle,
  type RepType,
} from "./lib/molstar/repstyle";
import {
  applyConformerStyling,
  applySecondaryGhost,
  hiddenConformerSelectors,
  planConformers,
  representationRefsForStructure,
  residueIdKey,
  type ResidueRange,
} from "./lib/molstar/conformers";
import { MetricProjector, samplerForVolume, trackToPoints } from "./lib/molstar/project";
import {
  buildAltGroupExpression,
  buildAtomQuery,
  buildResidueQuery,
  buildWatersQuery,
  exceptExpression,
  executeQuery,
  mergeExpressions,
  residueLoci,
} from "./lib/molstar/queries";
import { addDistanceMeasurement, clearMeasurements, measurementCount } from "./lib/molstar/measurements";
import { bondKey, computeBonds, isWaterEnd, type BondEndInfo, type BondPair } from "./lib/molstar/interactions";
import { ensureBondDashes, setBondDashesClip, type BondDash, type BondDashRefs } from "./lib/molstar/bond-dashes";
import { ALT_FALLBACK_COLOR, ALT_SHARED_COLOR, AltColors } from "./lib/molstar/altloc-theme";
import {
  addRange,
  EMPTY_SELECTION,
  formatRanges,
  normalizeSelection,
  rangesContain,
  selectionIsEmpty,
  selectionToRanges,
  toggleAtoms,
  toggleResidue,
  type AtomSel,
  type LabSelection,
} from "./lib/lab/selection";
import { loadBookmarks, MAX_BOOKMARKS, sanitizeRepStyle, saveBookmarks, type SelectionBookmark } from "./lib/lab/bookmarks";
import SlicePanel, { slicePlaneFor, type SliceAxis, type SlicePlane } from "./components/SlicePanel";
import DensityFlyout from "./components/compare/DensityFlyout";
import EntryCard from "./components/compare/EntryCard";
import EntryChip from "./components/compare/EntryChip";
import SelectionActionsPopup, { type ActionTarget, type ClipMode, type PickMode } from "./components/compare/SelectionActionsPopup";
import SelectionFlyout, { type SelectionSummary } from "./components/compare/SelectionFlyout";
import type { BondRow } from "./components/compare/BondList";
import StyleTray from "./components/compare/StyleTray";
import BookmarkTray from "./components/compare/BookmarkTray";
import { CARD_SHELL, Spinner } from "./components/compare/ui";
import SequenceLanes from "./components/lanes/SequenceLanes";
import { makeMetricLane } from "./components/lanes/PlotLanes";
import type { LaneMetric } from "./components/lanes/types";
import { fetchPdbeAnnotations, mapAnnotations, type AnnotationsBySource, type PdbeRaw } from "./lib/annotations/pdbe";
import { METRIC_ORDER, METRIC_UI, metricDescription, metricLabel, metricUnit, type MetricId } from "./components/compare/metrics";
import { WATER_COMPS, type ProvenanceRecord, type StageId, type StageState } from "./lib/lab/entries";
import { pickPair, ROLE_LABELS, type EntryManifest, type ManifestModel } from "./lib/dpdb/types";
import { resolveEntry } from "./lib/dpdb/resolve";
import { configureDpdb, toFetchableUrl, type DpdbConfig } from "./lib/dpdb/client";
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
  makeTrack,
  mapSupportDelta,
  mapValueTracks,
  modelRmsd,
  occupancyEntropy,
  trackDelta,
  type Track,
} from "@dynamic-pdb/hetkit/metrics";
import { Structure, StructureElement } from "molstar/lib/mol-model/structure";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";

// HetstarViewer: TWO models of one entry against their shared map. Model A is the qFit
// multiconformer rendered as SOLID warm camel sticks (MODEL_A_COLOR, shared with the 1D
// strip) COLLAPSED to its highest-occupancy conformer — expand per residue via the
// Selection Actions Panel on right click, or force one letter everywhere with the
// Conformer state buttons; model B is the deposited model as a cool ghost, hidden until
// toggled on. Density + metric projection + slice ride on top.

// Bonds touching any of the ranges. Only non-water ends count: a water's auth seq must not
// accidentally match a polymer range.
function bondsForRanges(bonds: readonly BondPair[], ranges: readonly ResidueRange[]): BondPair[] {
  const touches = (e: BondEndInfo) => !isWaterEnd(e) && rangesContain(ranges, e.chain, e.seq);
  return bonds.filter((p) => touches(p.a) || touches(p.b));
}

// The dashes (and partner waters) of every bond overlay, drawn from exactly the segments the
// bond list was computed from. A segment is dropped when either end's conformer letter is
// hidden on its residue (hiddenAltKeys: `chain|seq|letter`); shared "" segments always draw.
function dashesForOverlays(
  bonds: readonly BondPair[],
  overlays: readonly { key: string; ranges: ResidueRange[] }[],
  hiddenAltKeys: ReadonlySet<string>,
): { dashes: BondDash[]; waters: { chain: string; seq: number; alts: string[] }[] } {
  const pairs = new Map<string, BondPair>(); // overlapping overlays share pairs
  for (const ov of overlays) for (const p of bondsForRanges(bonds, ov.ranges)) pairs.set(bondKey(p), p);
  const dashes: BondDash[] = [];
  // partner waters come from SURVIVING segments only, with the letters those segments use,
  // so a water (or a water altloc copy) whose every dash is hidden renders no sphere either
  const waters = new Map<string, { chain: string; seq: number; alts: Set<string> }>();
  const addWater = (e: BondEndInfo, alt: string) => {
    if (!isWaterEnd(e)) return;
    const k = `${e.chain}|${e.seq}`;
    let w = waters.get(k);
    if (!w) waters.set(k, (w = { chain: e.chain, seq: e.seq, alts: new Set() }));
    w.alts.add(alt);
  };
  for (const p of pairs.values()) {
    for (const s of p.segments) {
      if (s.altA && hiddenAltKeys.has(`${p.a.chain}|${p.a.seq}|${s.altA}`)) continue;
      if (s.altB && hiddenAltKeys.has(`${p.b.chain}|${p.b.seq}|${s.altB}`)) continue;
      addWater(p.a, s.altA);
      addWater(p.b, s.altB);
      const letter = s.altA || s.altB;
      dashes.push({
        start: s.a,
        end: s.b,
        color: letter ? (AltColors[letter] ?? ALT_FALLBACK_COLOR) : ALT_SHARED_COLOR,
        label: `${p.a.comp}${p.a.seq} — ${p.type} — ${p.b.comp}${p.b.seq}${letter ? ` (conformer ${letter})` : ""}`,
      });
    }
  }
  return { dashes, waters: [...waters.values()].map((w) => ({ ...w, alts: [...w.alts] })) };
}

const VIEW: StructureView = { representation: "ball-and-stick", colorTheme: "uniform", uniformColor: MODEL_A_COLOR };
const DEFAULT_CLIP_RADIUS = 5;
// structure-factor downloads above this ask before fetching (PanDDA deposits run to hundreds of MB)
const SF_CONFIRM_MB = 50;

/** stable identity of a residue-range set — the key persistent overlays live under */
function rangesKey(ranges: ResidueRange[]): string {
  return ranges
    .map((r) => `${r.chain}:${r.from}-${r.to}`)
    .sort()
    .join(",");
}

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

// Heavy-atom centroid of the whole selection plus the radius that encloses it — the
// popup's clip sphere starts at fitRadius instead of the single-residue default.
function selectionStats(
  table: AtomTable,
  ranges: readonly ResidueRange[],
): { centroid: [number, number, number]; fitRadius: number } | null {
  const rows: number[] = [];
  let x = 0, y = 0, z = 0;
  table.residues.forEach((res) => {
    if (!rangesContain(ranges, res.ref.chain, res.ref.seq)) return;
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

// provenance prose for a model: the RCSB example rows bring their own; catalogue models get what
// the artifact record says about them
function describeModel(m: ManifestModel): string {
  if (m.note) return m.note;
  const bits = [ROLE_LABELS[m.role], m.format ?? "unknown format"];
  if (m.sizeBytes != null) bits.push(`${(m.sizeBytes / 1e6).toFixed(2)} MB`);
  if (m.sha256) bits.push(`sha256 ${m.sha256.slice(0, 12)}`);
  if (m.software) bits.push(m.software);
  return `${m.title} from the Dynamic PDB catalogue (${bits.join(", ")})`;
}

export interface HetstarViewerProps {
  /** dpdb_xxxxxxxx id (or a PDB id from the alias map / RCSB examples). Reloads when it changes. */
  entryId: string;
  /**
   * Where catalogue calls and non-CORS artifact downloads go. Defaults target the dev proxy
   * routes of the hetstar app (/api/dpdb, /api/dpdb-file); on dynamicpdb.com pass
   * { apiBase: "/api/v1" } and an empty fileProxy once the files host sends CORS.
   */
  dpdb?: DpdbConfig;
  /** classes for the outer wrapper; the viewer fills whatever box it is given */
  className?: string;
}

export default function HetstarViewer({ entryId, dpdb, className }: HetstarViewerProps) {
  configureDpdb(dpdb);
  const [viewer, setViewer] = useState<ViewerInstance | null>(null);

  // --- loader / entry state ---
  const [entryInput, setEntryInput] = useState(entryId);
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
  // bumps once a member scrub's Mol* commit has landed: memberIndex changes first, while
  // getCurrentStructure() still returns the previous frame
  const [frameVersion, setFrameVersion] = useState(0);

  // --- density state ---
  const [densityState, setDensityState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // maps compute in the background but stay hidden until the tray's density icon turns
  // them on; show2fofc stays true so that one click reveals the 2Fo-Fc
  const [showDensity, setShowDensity] = useState(false); // master switch over both maps
  const [show2fofc, setShow2fofc] = useState(true);
  const [showFofc, setShowFofc] = useState(false);
  const [sigma, setSigma] = useState(1.5);
  const [box, setBox] = useState<{ min: [number, number, number]; max: [number, number, number] } | null>(null);

  // --- selection / conformers / clip ---
  // the selection is normalized author-keyed ranges refined by individual atoms; a plain
  // click replaces it, shift-click (3D and lanes) toggles the clicked element in/out.
  // Residue-level consumers read the derived residueRanges below.
  const [sel, setSel] = useState<LabSelection>(EMPTY_SELECTION);
  // picking granularity: residue-wise (default), atom/bond-wise, or measure (two atom
  // clicks add a distance). Session preference; never cleared on entry switch.
  const [pickMode, setPickMode] = useState<PickMode>("residue");
  const [hoverInfo, setHoverInfo] = useState<PickInfo | null>(null);
  const [shownConformers, setShownConformers] = useState<ReadonlySet<string>>(new Set());
  const [globalAlt, setGlobalAlt] = useState<string | null>(null);
  // individually toggled-off conformers of expanded residues (`${residueKey}|${letter}`);
  // the structure layers, the selection marker and the bonds overlay all subtract them
  const [mutedAlts, setMutedAlts] = useState<ReadonlySet<string>>(new Set());
  const [clip, setClip] = useState<{
    center: [number, number, number];
    radius: number;
    includeModel: boolean;
  } | null>(null);
  // the Selection Actions Panel's anchor; it always targets the whole selection
  const [popup, setPopup] = useState<{ x: number; y: number } | null>(null);

  // --- persistent per-selection overlays ---
  // Both kinds are keyed by the serialized residue ranges they were created from and
  // OUTLIVE the selection: they stay until toggled off on the same ranges, or reset.
  // bondOverlays: app-drawn bond dashes (one shared node) + a lab-bonds waters component.
  // selRepOverlays: a representation override (atoms/sticks) on a lab-selrep component.
  const [bondOverlays, setBondOverlays] = useState<{ key: string; ranges: ResidueRange[] }[]>([]);
  const bondWatersRef = useRef<string | null>(null);
  const bondWatersReprRef = useRef<string | null>(null);
  const bondDashRef = useRef<BondDashRefs | null>(null);
  // model clip objects in force (isolate sphere / slice plane), kept by the clip task so
  // the bond overlay's freshly rebuilt nodes start out cut the same way
  const modelClipRef = useRef<ClipObjectSpec[]>([]);
  const [selRepOverlays, setSelRepOverlays] = useState<{ key: string; ranges: ResidueRange[]; type: RepType }[]>([]);
  const selRepRefs = useRef(new Map<string, string>());

  // --- distance measurements ---
  // the armed first atom of a two-click measure; version bumps refresh the count readout
  const [measureArm, setMeasureArm] = useState<{ chain: string; seq: number; atom: string; alt: string; comp: string } | null>(null);
  const measureArmRef = useRef<typeof measureArm>(null);
  useEffect(() => {
    measureArmRef.current = measureArm;
  }, [measureArm]);
  const [measureVersion, setMeasureVersion] = useState(0);
  // unique serializer keys so queued measurement writes never displace each other
  const measureSeqRef = useRef(0);

  // the residue-level view of the selection (atom parents included, adjacent parents
  // merged) — what every residue-keyed consumer reads; sel stays the source of truth
  const residueRanges = useMemo(() => selectionToRanges(sel), [sel]);

  // --- selection bookmarks (selection + RepStyle snapshot, persisted per entry) ---
  const [bookmarks, setBookmarks] = useState<SelectionBookmark[]>([]);

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
  const selectionRef = useRef<LabSelection>(EMPTY_SELECTION); // click handler reads the live selection
  const autoLoadRef = useRef<string | null>(null);
  // the components effect reads the style through a ref so style changes never rebuild
  // components (applyRepStyle restyles them in place)
  const repStyleRef = useRef(repStyle);
  useEffect(() => {
    repStyleRef.current = repStyle;
  }, [repStyle]);
  // the density load flow builds surfaces born hidden/visible from the CURRENT toggles
  // without gaining them as deps
  const visRef = useRef({ showDensity, show2fofc, showFofc });
  useEffect(() => {
    visRef.current = { showDensity, show2fofc, showFofc };
  }, [showDensity, show2fofc, showFofc]);

  // Serialize async Mol* pipelines: nothing runs concurrently, and while busy the
  // latest request wins PER KEY — rapid updates of one concern (say, conformer styling
  // on every pick) collapse to the newest, without dropping a different concern (say,
  // the ghost transparency or a representation switch) that queued in between.
  const makeSerializer = () => {
    const busy = { current: false };
    const pending = new Map<string, () => Promise<void>>();
    const run = (key: string, fn: () => Promise<void>, onError: (e: unknown) => void) => {
      if (busy.current) {
        // delete-then-set: a re-enqueued key moves to the tail, so pending order
        // always matches the latest enqueue order (declaration order of the effects)
        pending.delete(key);
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
    runStylingRef.current(key, fn, (e) => {
      console.error(`styling failed (${key}):`, e);
      setStatus(`styling failed (${key}): ${e instanceof Error ? e.message : String(e)}`);
    });
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
      setSel(EMPTY_SELECTION);
      setHoverInfo(null);
      setShownConformers(new Set());
      setGlobalAlt(null);
      setMutedAlts(new Set());
      setClip(null);
      setPopup(null);
      // the Mol* tree is about to be cleared: the overlays and every measurement die
      // with it, so the local handles must not outlive them
      setBondOverlays([]);
      bondWatersRef.current = null;
      bondWatersReprRef.current = null;
      bondDashRef.current = null;
      setSelRepOverlays([]);
      selRepRefs.current.clear();
      setMeasureArm(null);
      setMeasureVersion((v) => v + 1);
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

  // load the host's entry on mount and whenever it changes (StrictMode's double effect run
  // must not start two loads of the same id)
  useEffect(() => {
    if (autoLoadRef.current === entryId) return;
    autoLoadRef.current = entryId;
    setEntryInput(entryId);
    startLoad(entryId);
  }, [entryId, startLoad]);

  // --- second model into the same scene, once the primary is in ---

  useEffect(() => {
    if (!viewer || !primaryLoaded || !bText || !bTable || !entry || !pair?.b || secondaryRef || secondaryBusyRef.current) return;
    secondaryBusyRef.current = true;
    viewer
      .loadSecondary(bText, {
        label: `${entry.pdbId} ${pair.b.title}`,
        color: GHOST_B_COLOR,
        split: compSplitFromTable(bTable),
      })
      .then((ref) => setSecondaryRef(ref))
      .catch((e) => setLoadError(`model B failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        secondaryBusyRef.current = false;
      });
  }, [viewer, primaryLoaded, bText, bTable, entry, pair, secondaryRef]);

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

  // --- chemistry components of model A (lab-polymer / lab-het / lab-ion) ---
  // Declared FIRST among the styling effects: a component rebuild wipes the conformer
  // layers, rep params and selection marks, and declaration order = serializer enqueue
  // order, so everything downstream re-asserts onto the fresh components.

  // referentially stable across tables with the same comp split (ensemble member
  // scrubs), so a frame change never rebuilds the components — they survive the scrub
  const aSplitRef = useRef<CompSplit | null>(null);
  const aSplit = useMemo(() => {
    const next = aTable ? compSplitFromTable(aTable) : null;
    const prev = aSplitRef.current;
    if (
      next &&
      prev &&
      prev.polymer.join() === next.polymer.join() &&
      prev.het.join() === next.het.join() &&
      prev.ions.join() === next.ions.join()
    ) {
      return prev;
    }
    aSplitRef.current = next;
    return next;
  }, [aTable]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !viewer || !primaryLoaded || !aSplit) return;
    const structureRef = viewer.getPrimaryStructureRef();
    if (!structureRef) return;
    runStyling("components-a", async () => {
      // the task may run well after enqueue; if the tree was cleared/reloaded since,
      // bail — the fresh effect run handles the new tree
      if (viewer.getPrimaryStructureRef() !== structureRef) return;
      await ensureLabComponents(ctx, structureRef, aSplit, repStyleRef.current, { uniformColor: MODEL_A_COLOR });
    });
  }, [viewer, primaryLoaded, aSplit, runStyling]);

  // --- per-selection representation overrides (lab-selrep) ---
  // Declared BEFORE the conformer-layer effect (which depends on selRepOverlays), so a
  // fresh override component exists when the collapse/accent layers are (re)applied to
  // it — hidden conformers stay hidden and expanded letters stay colored inside the
  // override. The rep-style pass and the chemistry rebuild skip lab-selrep components.

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !viewer || !primaryLoaded) return;
    const structureRef = viewer.getPrimaryStructureRef();
    if (!structureRef) return;
    runStyling("selrep", async () => {
      if (viewer.getPrimaryStructureRef() !== structureRef) return;
      for (const ref of selRepRefs.current.values()) {
        try {
          await removeNode(ctx, ref);
        } catch {
          // died with a tree rebuild
        }
      }
      selRepRefs.current.clear();
      for (const ov of selRepOverlays) {
        const exprs = ov.ranges.map((r) => buildResidueQuery(r.chain, r.from, r.to === r.from ? undefined : r.to));
        const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
          structureRef,
          mergeExpressions(exprs),
          `lab-selrep-${ov.key}`,
          { label: "selection representation", tags: ["lab-selrep"] },
        );
        if (!comp) continue;
        selRepRefs.current.set(ov.key, comp.ref);
        // fixed override sizes — the global spacefill default (vdW 1.0) swallows the scene
        const styleForOverlay: RepStyle = {
          ...repStyleRef.current,
          type: ov.type,
          spacefill: { sizeFactor: SELREP_SPACEFILL_SIZE },
          ballStick: { sizeFactor: SELREP_BALLSTICK_SIZE },
        };
        await ctx.builders.structure.representation.addRepresentation(
          comp,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          reprSpecForRole("polymer", styleForOverlay, { uniformColor: MODEL_A_COLOR }) as any,
        );
      }
    });
  }, [viewer, primaryLoaded, selRepOverlays, runStyling]);

  // --- single-conformer collapse (per-residue expansion + naive global letter state) ---

  const altSummary = useMemo(() => (aTable ? summarizeAltlocs(aTable) : null), [aTable]);
  const confPlan = useMemo(() => planConformers(altSummary), [altSummary]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !primaryLoaded) return;
    const structureRef = viewer.getPrimaryStructureRef();
    if (!structureRef) return;
    runStyling("conformers", async () => {
      if (viewer.getPrimaryStructureRef() !== structureRef) return;
      await applyConformerStyling(ctx, structureRef, confPlan, {
        shown: shownConformers,
        globalAlt,
        muted: mutedAlts,
        polymerAsTrace: repStyle.type === "cartoon",
      });
    });
    // memberIndex: a frame scrub rebuilds the structure in place, dropping the layers;
    // aSplit: a component rebuild drops them too; repStyle.type: cartoon excludes the
    // polymer from the collapse layers, so a type switch re-applies them;
    // selRepOverlays: a fresh override component needs the layers applied to it
  }, [viewer, primaryLoaded, confPlan, shownConformers, globalAlt, mutedAlts, memberIndex, aSplit, repStyle.type, selRepOverlays, runStyling]);

  // --- representation style (tray): in-place state-tree updates on both models ---

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !viewer || !primaryLoaded) return;
    const structureRef = viewer.getPrimaryStructureRef();
    if (!structureRef) return;
    runStyling("rep-a", async () => {
      if (viewer.getPrimaryStructureRef() !== structureRef) return;
      await applyRepStyle(ctx, structureRef, repStyle, { uniformColor: MODEL_A_COLOR });
    });
  }, [viewer, primaryLoaded, repStyle, runStyling]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !secondaryRef) return;
    runStyling("rep-b", () => applyRepStyle(ctx, secondaryRef, repStyle, { uniformColor: GHOST_B_COLOR, ghost: true }));
  }, [viewer, secondaryRef, repStyle, runStyling]);

  // --- clip composition: residue sphere on the density (and, when isolating, on the
  // models too), slice plane on density + models. Serialized between the rep effects
  // and the selection re-assert: setClipObjects snapshots the tree at build time, so
  // running it concurrently with a style commit reverted the style wholesale (the old
  // dead-rep-buttons race).

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !viewer) return;
    runStyling("clip", async () => {
      const plane = planeRef.current;
      const planeObj = sliceModel && plane ? clipPlaneObject(plane.point, plane.normal) : null;
      const sphereObj = clip ? clipSphereObject(clip.center, clip.radius) : null;
      const r = reprsRef.current;
      if (r && densityState === "ready") {
        const densityObjs = [...(sphereObj ? [sphereObj] : []), ...(planeObj ? [planeObj] : [])];
        const densityRefs = [r.twoFoFc, r.foFcPos, r.foFcNeg];
        // re-assert after the update: a recreated isosurface visual comes back pickable
        await setClipObjects(ctx, densityRefs, densityObjs);
        setReprsPickable(ctx, densityRefs, false);
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
      modelClipRef.current = structObjs;
      if (structReprs.length) await setClipObjects(ctx, structReprs, structObjs);
      // the bond overlay: its root-level dash shape is outside the structure hierarchy, and
      // its waters repr (inside it, clipped above) must stay non-pickable after the update
      await setBondDashesClip(ctx, bondDashRef.current, structObjs);
      setReprsPickable(ctx, [bondWatersReprRef.current], false);
    });
    // repStyle: a full-params representation update wipes type.params.clip, so clip
    // re-applies after every style change; densityVersion: same, for rebuilt surfaces;
    // aSplit: rebuilt components carry fresh reprs.
  }, [viewer, clip, sliceModel, planeVersion, densityState, secondaryRef, primaryLoaded, repStyle, aSplit, densityVersion, runStyling]);

  // --- visibility-filtered loci: the collapse hides non-kept conformer letters with
  // transparency 1, but the outline postprocessing traces transparent geometry too —
  // so every MARKING path (selection, hover, lane hover, bond hover) subtracts the
  // hidden altloc atoms. The hidden loci are cached per structure + collapse state:
  // hover asks at pointer rate.

  const hiddenSelectors = useMemo(
    () => hiddenConformerSelectors(confPlan, { shown: shownConformers, globalAlt, muted: mutedAlts }),
    [confPlan, shownConformers, globalAlt, mutedAlts],
  );
  const hiddenLociCacheRef = useRef<{
    structure: Structure;
    selectors: typeof hiddenSelectors;
    loci: StructureElement.Loci | null;
  } | null>(null);
  const visibleLoci = useCallback(
    (structure: Structure, loci: StructureElement.Loci | null): StructureElement.Loci | null => {
      if (!loci) return null;
      if (!hiddenSelectors.length) return loci;
      const c = hiddenLociCacheRef.current;
      let hidden: StructureElement.Loci | null;
      if (c && c.structure === structure && c.selectors === hiddenSelectors) {
        hidden = c.loci;
      } else {
        hidden = executeQuery(buildAltGroupExpression(hiddenSelectors), structure);
        hiddenLociCacheRef.current = { structure, selectors: hiddenSelectors, loci: hidden };
      }
      if (!hidden) return loci;
      const sub = StructureElement.Loci.subtract(loci, hidden);
      return StructureElement.Loci.isEmpty(sub) ? null : sub;
    },
    [hiddenSelectors],
  );

  // --- selection marking: the selected ranges become a Mol* selection (the default
  // green select tint). Declared AFTER the rep-style and clip effects and keyed
  // separately in the serializer, so on a representation rebuild (which drops marker
  // state) the re-assert runs last; conformer restyles are deps for the same reason.

  useEffect(() => {
    if (!viewer || !primaryLoaded) return;
    runStyling("selection", async () => {
      const structure = viewer.getCurrentStructure();
      if (!structure) return;
      const exprs = [
        ...sel.ranges.map((r) => buildResidueQuery(r.chain, r.from, r.to === r.from ? undefined : r.to)),
        ...sel.atoms.map((a) => buildAtomQuery(a.chain, a.seq, a.atom)),
      ];
      if (!exprs.length) {
        viewer.clearSelection();
        return;
      }
      // The marker shows only what is on screen: the altloc atoms the collapse hides
      // (transparency 1, but still outlined by the includeTransparent postprocessing)
      // are subtracted, so the green outline never traces an invisible ghost conformer.
      // The selection MODEL stays altloc-agnostic — every action still generalizes to
      // all conformer copies.
      let expr = mergeExpressions(exprs);
      if (hiddenSelectors.length) expr = exceptExpression(expr, buildAltGroupExpression(hiddenSelectors));
      const loci = executeQuery(expr, structure);
      if (loci) viewer.setSelection(loci);
      else viewer.clearSelection();
    });
    // memberIndex: the selection marker must re-assert on the rebuilt frame
  }, [viewer, primaryLoaded, sel, repStyle, hiddenSelectors, memberIndex, aSplit, runStyling]);

  // --- typed non-covalent bonds (Mol* interaction engine), computed once per loaded
  // frame; the selection flyout filters them to the current selection. Pure compute —
  // no state-tree writes, so it does not ride the styling serializer.

  const [bonds, setBonds] = useState<BondPair[] | null>(null);
  useEffect(() => {
    setBonds(null);
    const ctx = viewer?.ctx;
    if (!ctx || !viewer || !primaryLoaded) return;
    const structure = viewer.getCurrentStructure();
    if (!structure) return;
    let stale = false;
    computeBonds(ctx, structure)
      .then((b) => {
        if (!stale) setBonds(b);
      })
      .catch((e) => console.error("interaction computation failed:", e));
    return () => {
      stale = true;
    };
    // frameVersion, not memberIndex: a scrub swaps the structure under the same refs, and
    // reading it before the commit lands would bake the previous frame's coordinates into
    // the bond dashes
  }, [viewer, primaryLoaded, frameVersion]);

  const selectionBonds = useMemo(() => {
    if (!bonds || !residueRanges.length) return [];
    return bondsForRanges(bonds, residueRanges);
  }, [bonds, residueRanges]);

  // chain|seq -> altloc letters of that residue when split (insertion codes collapsed;
  // bond ends carry no ins)
  const lettersByResidue = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const alt of confPlan.byKey.values()) {
      if (alt.altIds.length > 1) m.set(`${alt.ref.chain}|${alt.ref.seq}`, alt.altIds);
    }
    return m;
  }, [confPlan]);

  // a bond exists under some but not all conformers of its end residues
  const confDependent = useCallback(
    (pair: BondPair) => {
      if (!pair.alts.length) return false;
      const expected = new Set<string>([
        ...(lettersByResidue.get(`${pair.a.chain}|${pair.a.seq}`) ?? []),
        ...(lettersByResidue.get(`${pair.b.chain}|${pair.b.seq}`) ?? []),
      ]);
      return [...expected].some((l) => !pair.alts.includes(l));
    },
    [lettersByResidue],
  );

  const bondPairLoci = useCallback(
    (pair: BondPair) => {
      const structure = viewer?.getCurrentStructure();
      if (!structure) return null;
      const la = residueLoci(structure, pair.a.chain, pair.a.seq);
      const lb = residueLoci(structure, pair.b.chain, pair.b.seq);
      if (la && lb) return StructureElement.Loci.union(la, lb);
      return la ?? lb ?? null;
    },
    [viewer],
  );
  const onBondHover = useCallback(
    (pair: BondPair | null) => {
      if (!viewer) return;
      if (!pair) {
        viewer.highlightLoci(null);
        return;
      }
      const structure = viewer.getCurrentStructure();
      const loci = bondPairLoci(pair);
      viewer.highlightLoci(structure && loci ? visibleLoci(structure, loci) : loci);
    },
    [viewer, bondPairLoci, visibleLoci],
  );
  const onBondFocus = useCallback(
    (pair: BondPair) => {
      const loci = bondPairLoci(pair);
      if (loci && viewer) viewer.focusLoci(loci);
    },
    [viewer, bondPairLoci],
  );

  // --- 3D painting of bonds: PERSISTENT overlays (each holds the residue ranges it was
  // activated on) outlive the selection until toggled off on the same ranges or reset.
  // The dashes are our own shape built from the same `bonds` the list shows (Mol*'s
  // interactions repr drew contacts to unrendered waters and dropped most intra-chain
  // ones), so scene and list agree by construction; `bonds` recomputes per frame scrub,
  // so dashes follow the frame. Water partners render as small spheres on a "lab-bonds"
  // component, exempt from the style pass and chemistry rebuild (repstyle filters the
  // tag); this effect owns both nodes' lifecycle.

  // `chain|seq|letter` of every conformer the collapse/mute state hides (entries are
  // single-residue); a dash under a hidden letter disappears with its atoms
  const hiddenAltKeys = useMemo(() => {
    const out = new Set<string>();
    for (const h of hiddenSelectors) out.add(`${h.chain}|${h.seqStart}|${h.altId}`);
    return out;
  }, [hiddenSelectors]);

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !viewer || !primaryLoaded) return;
    const structureRef = viewer.getPrimaryStructureRef();
    if (!structureRef) return;
    // mid-recompute (frame scrub): keep the previous overlay until this frame's bonds land
    if (!bonds) return;
    runStyling("bonds3d", async () => {
      if (viewer.getPrimaryStructureRef() !== structureRef) return;
      if (bondWatersRef.current) {
        try {
          await removeNode(ctx, bondWatersRef.current);
        } catch {
          // the component died with a tree rebuild; nothing to remove
        }
        bondWatersRef.current = null;
        bondWatersReprRef.current = null;
      }
      const { dashes, waters } = dashesForOverlays(bonds, bondOverlays, hiddenAltKeys);
      const clipObjects = modelClipRef.current;
      bondDashRef.current = await ensureBondDashes(ctx, bondDashRef.current, dashes, clipObjects);
      if (!waters.length) return;
      const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
        structureRef,
        buildWatersQuery(waters, [...WATER_COMPS]),
        "lab-bonds-waters",
        { label: "bond waters", tags: ["lab-bonds"] },
      );
      if (!comp) return;
      bondWatersRef.current = comp.ref;
      const repr = await ctx.builders.structure.representation.addRepresentation(comp, {
        type: "spacefill",
        typeParams: { sizeFactor: 0.25, ignoreLight: true, clip: { variant: "pixel", objects: clipObjects } },
        color: "element-symbol",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // picking a water would select a residue the rest of the panel treats as empty
      bondWatersReprRef.current = repr?.ref ?? null;
      setReprsPickable(ctx, [bondWatersReprRef.current], false);
    });
  }, [viewer, primaryLoaded, bonds, bondOverlays, hiddenAltKeys, aSplit, runStyling]);

  // --- interaction: left click selects (shift toggles the clicked residue or atom in
  // and out, file-browser style); right click always opens the Selection Actions Panel —
  // on the whole selection when one exists, seeding the element under the cursor
  // otherwise. Both ride Mol*'s click event, which fires for any
  // button with a FRESH synchronous pick at the release point (hover is async/throttled
  // and used to go stale here) and already rejects camera drags (no click when the
  // pointer moved between down and up). contextmenu is only suppressed (it fires on
  // mousedown on macOS).

  useEffect(() => {
    selectionRef.current = sel;
  }, [sel]);

  // The click that dismisses the Selection Actions Panel must not ALSO act as a
  // selection click (it used to clear or replace the selection — most visibly right
  // after switching pick modes in the panel). useDismiss closes the card on mousedown,
  // so by the time Mol*'s click lands at mouseup the popup state is already null; the
  // "this press began outside an open popup" fact is captured here at mousedown time
  // and the handlers below swallow that one click. Every mousedown overwrites the flag,
  // so a dismissal that turns into a camera drag (no click event) cannot go stale.
  const popupOpenRef = useRef(false);
  useEffect(() => {
    popupOpenRef.current = popup !== null;
  }, [popup]);
  const dismissClickRef = useRef(false);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      dismissClickRef.current =
        popupOpenRef.current && !(e.target as Element | null)?.closest?.("[data-selection-popup]");
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);

  // hover-highlight granularity follows the pick mode; clicks arrive atom-precise
  // either way (granularity only shapes what the mark managers light up)
  useEffect(() => {
    if (!viewer) return;
    viewer.setGranularity(pickMode === "residue" ? "residue" : "element");
  }, [viewer, pickMode, primaryLoaded]);

  // leaving measure mode drops a half-finished measurement
  useEffect(() => {
    if (pickMode !== "measure") setMeasureArm(null);
  }, [pickMode]);

  // distinct atom names per residue (altloc copies deduped, hydrogens kept — anything
  // clickable must be togglable): the enumeration toggleAtoms needs to explode a
  // range-covered residue into its remaining atoms
  const residueAtomNamesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!aTable) return map;
    for (const res of aTable.residues) {
      const names = new Set<string>();
      for (const r of res.rows) names.add(aTable.atomName[r]);
      map.set(`${res.ref.chain}|${res.ref.seq}`, [...names]);
    }
    return map;
  }, [aTable]);
  const residueAtomNames = useCallback(
    (chain: string, seq: number) => residueAtomNamesMap.get(`${chain}|${seq}`) ?? [],
    [residueAtomNamesMap],
  );

  useEffect(() => {
    if (!viewer) return;
    return viewer.subscribeToClick((info, meta) => {
      const dismissedPopup = dismissClickRef.current;
      dismissClickRef.current = false;
      // middle click: reset the camera (and nothing else — without this it fell through
      // to the left-click branch and cleared the selection)
      if (meta.button === 4) {
        void viewer.resetCamera();
        return;
      }
      // an atom-mode pick takes the atom, and both end atoms when it landed on a bond
      const pickedAtoms = (p: PickInfo): AtomSel[] => {
        const end: AtomSel = { chain: p.chainId, seq: p.authSeqId, atom: p.atomId };
        return p.bondPartner
          ? [end, { chain: p.bondPartner.chainId, seq: p.bondPartner.authSeqId, atom: p.bondPartner.atomId }]
          : [end];
      };
      if (meta.button === 2) {
        const anchor = meta.clientX != null && meta.clientY != null ? { x: meta.clientX, y: meta.clientY } : null;
        if (!anchor) return;
        // the popup opens regardless — with neither selection nor pick it still offers
        // the pick-mode toggles; a pick under the cursor seeds the selection first
        if (selectionIsEmpty(selectionRef.current) && info) {
          setSel(
            pickMode === "atom"
              ? normalizeSelection({ ranges: [], atoms: pickedAtoms(info) })
              : { ranges: [{ chain: info.chainId, from: info.authSeqId, to: info.authSeqId }], atoms: [] },
          );
        }
        setPopup(anchor);
        return;
      }
      // a left click whose press dismissed the popup is consumed, OS-menu style — it
      // neither clears nor replaces the selection (right click above re-anchors instead)
      if (dismissedPopup) return;
      // measure mode: two atom clicks add a distance; a miss (or re-clicking the armed
      // atom) disarms. The selection is untouched.
      if (pickMode === "measure") {
        if (!info || !info.atomId) {
          setMeasureArm(null);
          return;
        }
        const cur = { chain: info.chainId, seq: info.authSeqId, atom: info.atomId, alt: info.altId, comp: info.compId };
        const prev = measureArmRef.current;
        if (!prev) {
          setMeasureArm(cur);
          return;
        }
        setMeasureArm(null);
        if (prev.chain === cur.chain && prev.seq === cur.seq && prev.atom === cur.atom && prev.alt === cur.alt) return;
        const ctx = viewer.ctx;
        if (!ctx) return;
        runStyling(`measure-${++measureSeqRef.current}`, async () => {
          const structure = viewer.getCurrentStructure();
          if (!structure) return;
          const la = executeQuery(buildAtomQuery(prev.chain, prev.seq, prev.atom, prev.alt || undefined), structure);
          const lb = executeQuery(buildAtomQuery(cur.chain, cur.seq, cur.atom, cur.alt || undefined), structure);
          if (la && lb) await addDistanceMeasurement(ctx, la, lb);
          setMeasureVersion((v) => v + 1);
        });
        return;
      }
      const shift = !!meta.modifiers?.shift;
      if (info) {
        if (pickMode === "atom") {
          const picked = pickedAtoms(info);
          setSel((prev) =>
            shift ? toggleAtoms(prev, picked, residueAtomNames) : normalizeSelection({ ranges: [], atoms: picked }),
          );
        } else {
          setSel((prev) =>
            shift
              ? toggleResidue(prev, info.chainId, info.authSeqId)
              : { ranges: [{ chain: info.chainId, from: info.authSeqId, to: info.authSeqId }], atoms: [] },
          );
        }
        if (!shift) setPopup(null);
      } else if (!shift) {
        setSel(EMPTY_SELECTION);
        setPopup(null);
      }
    });
  }, [viewer, pickMode, residueAtomNames, runStyling]);

  // The HighlightLoci behavior runs with mark: false (spec.ts): the raw pick loci
  // include transparency-hidden ghost conformers, which the outline postprocessing
  // would trace. The canvas hover mark is drawn here instead, visibility-filtered.
  useEffect(() => {
    if (!viewer) return;
    return viewer.subscribeToHover((info) => {
      const key = info
        ? pickMode === "residue"
          ? `${info.chainId}|${info.authSeqId}|${info.insCode}`
          : `${info.chainId}|${info.authSeqId}|${info.insCode}|${info.atomId}|${info.altId}`
        : null;
      if (key === hoverKeyRef.current) return;
      hoverKeyRef.current = key;
      setHoverInfo(info);
      if (!info) {
        viewer.highlightLoci(null);
        return;
      }
      const structure = viewer.getCurrentStructure();
      if (!structure) return;
      if (pickMode === "residue") {
        viewer.highlightLoci(visibleLoci(structure, residueLoci(structure, info.chainId, info.authSeqId)));
      } else {
        // atom-precise (hidden atoms are unpickable, so no subtraction needed)
        viewer.highlightLoci(
          executeQuery(buildAtomQuery(info.chainId, info.authSeqId, info.atomId, info.altId || undefined), structure),
        );
      }
    });
  }, [viewer, pickMode, visibleLoci]);

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
        const vis = visRef.current;
        const reprs = await buildIsosurfaces(ctx, vols, {
          hidden: {
            twoFoFc: !(vis.show2fofc && vis.showDensity),
            foFc: !(vis.showFofc && vis.showDensity),
          },
        });
        if (stale()) return;
        setStage("iso", "done");
        volsRef.current = vols;
        reprsRef.current = reprs;
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
    const t = setTimeout(() => runStyling("iso-sigma", () => updateIsoSigma(ctx, ref, sigma)), 80);
    return () => clearTimeout(t);
  }, [viewer, sigma, densityState, densityVersion, runStyling]);

  // opacity slider: factor over both maps' base alphas, debounced like the contour
  useEffect(() => {
    const ctx = viewer?.ctx;
    const r = reprsRef.current;
    if (!ctx || !r || densityState !== "ready") return;
    const t = setTimeout(() => runStyling("density-alpha", () => setDensityAlpha(ctx, r, densityOpacity)), 80);
    return () => clearTimeout(t);
  }, [viewer, densityOpacity, densityState, densityVersion, runStyling]);

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
            hidden: {
              twoFoFc: !(show2fofc && showDensity),
              foFc: !(showFofc && showDensity),
            },
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
    [viewer, densityState, densityBusy, densityQuality, sigma, densityOpacity, slice3d, showDensity, show2fofc, showFofc],
  );

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
      if (viewer) void viewer.setModelIndex(clamped).then(() => setFrameVersion((v) => v + 1));
      setATable(memberTables[clamped]);
    },
    [memberTables, viewer],
  );

  // --- cross-member bond presence: compute every member's bond set off-tree (each
  // trajectory frame -> Structure.ofModel -> the same interaction pass the current-frame
  // list uses), so the UI can say a bond exists in some ensemble states but not others.
  // One sequential background pass per loaded entry; scrubbing does not re-run it.
  const [memberBonds, setMemberBonds] = useState<Map<string, { pair: BondPair; members: number[] }> | null>(null);
  const [memberBondsDone, setMemberBondsDone] = useState(0);
  useEffect(() => {
    setMemberBonds(null);
    setMemberBondsDone(0);
    const ctx = viewer?.ctx;
    if (!ctx || !viewer || !primaryLoaded || memberTables.length < 2) return;
    let stale = false;
    (async () => {
      const acc = new Map<string, { pair: BondPair; members: number[] }>();
      for (let i = 0; i < memberTables.length; i++) {
        const model = await viewer.getFrameModel(i);
        if (stale) return;
        if (!model) continue;
        const frameBonds = await computeBonds(ctx, Structure.ofModel(model));
        if (stale) return;
        for (const pair of frameBonds) {
          const k = bondKey(pair);
          const rec = acc.get(k);
          if (rec) rec.members.push(i);
          else acc.set(k, { pair, members: [i] });
        }
        setMemberBondsDone(i + 1);
      }
      setMemberBonds(acc);
    })().catch((e) => console.error("member bond computation failed:", e));
    return () => {
      stale = true;
    };
  }, [viewer, primaryLoaded, memberTables]);

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
        case "bond-variability": {
          if (!bonds) return null;
          // per residue: bonds touching it that are NOT invariant — missing under at
          // least one conformer of their residues, or absent in some ensemble members
          // (ghost bonds of other members included once the member pass is in)
          const diff = new Map<string, BondPair>();
          for (const pair of bonds) if (confDependent(pair)) diff.set(bondKey(pair), pair);
          if (memberBonds) {
            for (const [k, rec] of memberBonds) {
              if (rec.members.length < memberTables.length && !diff.has(k)) diff.set(k, rec.pair);
            }
          }
          const counts = new Map<string, number>();
          // water contacts count on their polymer partner only: a water's chain|seq key could
          // collide with a polymer residue's auth numbering
          for (const pair of diff.values()) {
            for (const e of [pair.a, pair.b]) {
              if (isWaterEnd(e)) continue;
              const k = `${e.chain}|${e.seq}`;
              counts.set(k, (counts.get(k) ?? 0) + 1);
            }
          }
          const values = new Float32Array(aTable.residues.length);
          aTable.residues.forEach((res, i) => {
            values[i] = counts.get(`${res.ref.chain}|${res.ref.seq}`) ?? 0;
          });
          return makeTrack(
            "bond-variability",
            "residue",
            aTable.residues.map((r) => r.ref),
            values,
            { unit: "bonds" },
          );
        }
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
    [viewer, aTable, bTable, memberTables, bonds, memberBonds, confDependent],
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
      if (id === "bond-variability" && bonds === null) {
        out.set(id, "computing interactions");
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
  }, [aTable, bTable, memberTables, densityState, densityVersion, bonds, computeBaseTrack]);

  const metricLaneModules = useMemo(
    () => METRIC_ORDER.map((id) => makeMetricLane(id, metricLabel(id), metricDescription(id))),
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

  // The model box frames the slice plane; taken from the structure itself so the plane
  // (and slice-model clipping) works before any density is in.
  useEffect(() => {
    if (!viewer || !primaryLoaded) return;
    const structure = viewer.getCurrentStructure();
    const b = structure?.boundary.box;
    if (b) setBox({ min: [b.min[0], b.min[1], b.min[2]], max: [b.max[0], b.max[1], b.max[2]] });
  }, [viewer, primaryLoaded, memberIndex]);

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
        runStyling("slice-plane", async () => {
          if (slice3dNodeRef.current) await updateSlice(ctx, slice3dNodeRef.current, slicePlane.point, slicePlane.normal);
        });
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [slicePlane, viewer, runStyling]);

  // One reconciling task (its own key, so a queued plane update never displaces it):
  // latest-wins per key means a rapid on/off leaves only the newest intent.
  useEffect(() => {
    const ctx = viewer?.ctx;
    const vol = volsRef.current?.twoFoFc;
    if (!ctx || !vol || densityState !== "ready") return;
    const want = slice3d;
    runStyling("slice-node", async () => {
      if (want && !slice3dNodeRef.current && planeRef.current) {
        const p = planeRef.current;
        slice3dNodeRef.current = await createSlice(ctx, vol, p.point, p.normal);
      } else if (!want && slice3dNodeRef.current) {
        await removeNode(ctx, slice3dNodeRef.current);
        slice3dNodeRef.current = null;
      }
    });
    // planeVersion: after an entry switch planeRef is null until the new box yields a plane;
    // the bump retries the create once a plane exists again.
  }, [viewer, slice3d, densityState, planeVersion, runStyling]);

  // --- selection helpers (popup + flyout + lanes) ---

  // an author-keyed lane residue as a PickInfo, centroid included (what a 3D pick carries)
  const pickFromRef = useCallback(
    (ref: ResidueRef): PickInfo | null => {
      if (!aTable) return null;
      const res = aTable.residues.find((r) => r.ref.chain === ref.chain && r.ref.seq === ref.seq);
      if (!res) return null;
      const info: PickInfo = { chainId: res.ref.chain, authSeqId: res.ref.seq, compId: res.compId, atomId: "", altId: "", insCode: res.ref.ins };
      const c = residueCentroid(aTable, info);
      return { ...info, position3d: c ?? undefined };
    },
    [aTable],
  );

  // a selection of exactly one residue behaves like the old single pick: it feeds the
  // support table and the popup's comp header (the clicked atom's altId is not tracked)
  const soleResidue = useMemo(
    () => (residueRanges.length === 1 && residueRanges[0].from === residueRanges[0].to ? residueRanges[0] : null),
    [residueRanges],
  );
  const picked = useMemo<PickInfo | null>(
    () => (soleResidue ? pickFromRef({ chain: soleResidue.chain, seq: soleResidue.from, ins: "" }) : null),
    [soleResidue, pickFromRef],
  );

  const pickedKey = picked ? residueIdKey({ chain: picked.chainId, seq: picked.authSeqId, ins: picked.insCode }) : null;
  const pickedAltIds = pickedKey ? (confPlan.byKey.get(pickedKey)?.altIds ?? []) : [];
  const pickedConformerCount = pickedKey ? (pickedAltIds.length || 1) : null;
  const pickedShown = !!(pickedKey && shownConformers.has(pickedKey));

  // aggregates over the whole selection: what the actions panel acts on, plus the
  // occupancy/heterogeneity summary the selection flyout reports
  const selectionInfo = useMemo(() => {
    if (!aTable || !residueRanges.length) return null;
    const splitKeys: string[] = [];
    const letters = new Set<string>();
    const histogram = new Map<number, number>();
    let residueCount = 0;
    let bSum = 0, bN = 0, occSum = 0, occN = 0;
    for (const res of aTable.residues) {
      if (WATER_COMPS.has(res.compId)) continue;
      if (!rangesContain(residueRanges, res.ref.chain, res.ref.seq)) continue;
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
      stats: selectionStats(aTable, residueRanges),
      histogram: [...histogram.entries()].sort((a, b) => a[0] - b[0]) as [number, number][],
      meanAltOcc: occN ? occSum / occN : null,
      meanB: bN ? bSum / bN : null,
    };
  }, [aTable, residueRanges, confPlan]);

  // --- annotated bond rows: which conformers form each selection bond, whether it is
  // missing under some conformer of its residues, in how many ensemble members it
  // exists, plus grayed "ghost" bonds formed only in OTHER members.

  const bondRows = useMemo<BondRow[]>(() => {
    const memberCount = memberBonds ? memberTables.length : null;
    const rows: BondRow[] = [];
    const currentKeys = new Set<string>();
    for (const pair of selectionBonds) {
      const k = bondKey(pair);
      currentKeys.add(k);
      rows.push({
        pair,
        dependent: confDependent(pair),
        presentIn: memberBonds ? (memberBonds.get(k)?.members.length ?? 0) : null,
        memberCount,
        ghost: false,
      });
    }
    if (memberBonds && residueRanges.length) {
      for (const { pair, members } of memberBonds.values()) {
        if (members.includes(memberIndex) || currentKeys.has(bondKey(pair))) continue;
        if (
          !rangesContain(residueRanges, pair.a.chain, pair.a.seq) &&
          !rangesContain(residueRanges, pair.b.chain, pair.b.seq)
        )
          continue;
        rows.push({ pair, dependent: false, presentIn: members.length, memberCount, ghost: true });
      }
    }
    return rows;
  }, [selectionBonds, memberBonds, memberTables.length, confDependent, residueRanges, memberIndex]);

  const bondSummary = useMemo<string | null>(() => {
    const parts: string[] = [];
    const confDiff = bondRows.filter((r) => !r.ghost && r.dependent).length;
    if (confDiff) parts.push(`${confDiff} bond${confDiff === 1 ? " differs" : "s differ"} across conformers`);
    if (memberBonds) {
      const partial = bondRows.filter((r) => !r.ghost && r.presentIn != null && r.presentIn < memberTables.length).length;
      const ghosts = bondRows.filter((r) => r.ghost).length;
      if (partial) parts.push(`${partial} vary across members`);
      if (ghosts) parts.push(`${ghosts} only in other members`);
    } else if (memberTables.length >= 2 && primaryLoaded) {
      parts.push(`mapping member bonds ${memberBondsDone}/${memberTables.length}…`);
    }
    return parts.length ? parts.join(" · ") : null;
  }, [bondRows, memberBonds, memberBondsDone, memberTables.length, primaryLoaded]);

  const selectionSummary = useMemo<SelectionSummary | null>(
    () =>
      residueRanges.length && selectionInfo
        ? {
            label: formatRanges(residueRanges, { maxSegments: 3 }),
            residueCount: selectionInfo.residueCount,
            splitCount: selectionInfo.splitKeys.length,
            histogram: selectionInfo.histogram,
            meanAltOcc: selectionInfo.meanAltOcc,
            meanB: selectionInfo.meanB,
          }
        : null,
    [residueRanges, selectionInfo],
  );

  const popupShown =
    !!selectionInfo &&
    selectionInfo.splitKeys.length > 0 &&
    selectionInfo.splitKeys.every((k) => shownConformers.has(k));

  // toggles EVERY split residue of the selection at once (all shown -> collapse all,
  // otherwise expand all)
  const togglePopupConformers = useCallback(() => {
    const keys = selectionInfo?.splitKeys ?? [];
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
  }, [selectionInfo]);

  // --- distance measurements: conformer spread + clear (the two-click measure mode
  // lives in the click handler above) ---

  // every split atom of the selection with its altloc letters: explicit atom picks
  // measure just those atoms, range-selected residues measure all their split atoms
  const spreadTargets = useMemo(() => {
    if (!aTable) return [];
    const targets: { chain: string; seq: number; atom: string; letters: string[] }[] = [];
    const seen = new Set<string>();
    const pushResidueAtoms = (res: (typeof aTable.residues)[number], onlyAtom?: string) => {
      const byName = new Map<string, Set<string>>();
      for (const r of res.rows) {
        const name = aTable.atomName[r];
        if (onlyAtom && name !== onlyAtom) continue;
        const alt = aTable.altId[r];
        if (!alt) continue;
        let letters = byName.get(name);
        if (!letters) {
          letters = new Set();
          byName.set(name, letters);
        }
        letters.add(alt);
      }
      for (const [name, letters] of byName) {
        if (letters.size < 2) continue;
        const key = `${res.ref.chain}|${res.ref.seq}|${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ chain: res.ref.chain, seq: res.ref.seq, atom: name, letters: [...letters].sort() });
      }
    };
    for (const res of aTable.residues) {
      if (WATER_COMPS.has(res.compId)) continue;
      if (rangesContain(sel.ranges, res.ref.chain, res.ref.seq)) {
        pushResidueAtoms(res);
        continue;
      }
      for (const a of sel.atoms) {
        if (a.chain === res.ref.chain && a.seq === res.ref.seq) pushResidueAtoms(res, a.atom);
      }
    }
    return targets;
  }, [aTable, sel]);

  const MEASURE_SPREAD_CAP = 30;
  const addConformerSpread = useCallback(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !viewer || !spreadTargets.length) return;
    runStyling(`measure-${++measureSeqRef.current}`, async () => {
      const structure = viewer.getCurrentStructure();
      if (!structure) return;
      let added = 0;
      let capped = false;
      outer: for (const t of spreadTargets) {
        for (let i = 0; i < t.letters.length; i++) {
          for (let j = i + 1; j < t.letters.length; j++) {
            if (added >= MEASURE_SPREAD_CAP) {
              capped = true;
              break outer;
            }
            const la = executeQuery(buildAtomQuery(t.chain, t.seq, t.atom, t.letters[i]), structure);
            const lb = executeQuery(buildAtomQuery(t.chain, t.seq, t.atom, t.letters[j]), structure);
            if (!la || !lb) continue;
            await addDistanceMeasurement(ctx, la, lb);
            added++;
          }
        }
      }
      setMeasureVersion((v) => v + 1);
      setStatus(
        added
          ? `${added} conformer distance${added === 1 ? "" : "s"} added${capped ? ` (capped at ${MEASURE_SPREAD_CAP})` : ""}`
          : "no split atoms in the selection",
      );
    });
  }, [viewer, spreadTargets, runStyling]);

  const clearAllMeasurements = useCallback(() => {
    const ctx = viewer?.ctx;
    if (!ctx) return;
    runStyling(`measure-${++measureSeqRef.current}`, async () => {
      await clearMeasurements(ctx);
      setMeasureVersion((v) => v + 1);
    });
  }, [viewer, runStyling]);

  // --- persistent overlay toggles + whole-view reset ---

  const currentRangesKey = useMemo(() => rangesKey(residueRanges), [residueRanges]);

  const bondsOverlayActive = bondOverlays.some((o) => o.key === currentRangesKey);
  const toggleBondsOverlay = useCallback(() => {
    if (!residueRanges.length) return;
    const key = rangesKey(residueRanges);
    setBondOverlays((prev) =>
      prev.some((o) => o.key === key) ? prev.filter((o) => o.key !== key) : [...prev, { key, ranges: residueRanges }],
    );
  }, [residueRanges]);

  const selRepActive = selRepOverlays.find((o) => o.key === currentRangesKey)?.type ?? null;
  const setSelRep = useCallback(
    (type: RepType | null) => {
      if (!residueRanges.length) return;
      const key = rangesKey(residueRanges);
      setSelRepOverlays((prev) => {
        const rest = prev.filter((o) => o.key !== key);
        return type ? [...rest, { key, ranges: residueRanges, type }] : rest;
      });
    },
    [residueRanges],
  );

  // per-letter conformer toggles for the CURRENT selection's expanded residues: a letter
  // is "off" when every selection residue carrying it is muted; toggling flips them all
  const selectionMutedLetters = useMemo<string[]>(() => {
    const keys = selectionInfo?.splitKeys ?? [];
    if (!keys.length) return [];
    return (selectionInfo?.letters ?? []).filter((letter) => {
      const carriers = keys.filter((k) => confPlan.byKey.get(k)?.altIds.includes(letter));
      return carriers.length > 0 && carriers.every((k) => mutedAlts.has(`${k}|${letter}`));
    });
  }, [selectionInfo, confPlan, mutedAlts]);

  const toggleConformerLetter = useCallback(
    (letter: string) => {
      const keys = selectionInfo?.splitKeys ?? [];
      const carriers = keys.filter((k) => confPlan.byKey.get(k)?.altIds.includes(letter));
      if (!carriers.length) return;
      setMutedAlts((prev) => {
        const next = new Set(prev);
        const allMuted = carriers.every((k) => prev.has(`${k}|${letter}`));
        for (const k of carriers) {
          if (allMuted) next.delete(`${k}|${letter}`);
          else next.add(`${k}|${letter}`);
        }
        return next;
      });
    },
    [selectionInfo, confPlan],
  );

  // back to the freshly-loaded look: conformers collapsed, default style, no overlays,
  // no clip, no measurements, empty selection. Bookmarks and density settings persist.
  const resetAll = useCallback(() => {
    setSel(EMPTY_SELECTION);
    setPopup(null);
    setShownConformers(new Set());
    setGlobalAlt(null);
    setMutedAlts(new Set());
    setRepStyle(sanitizeRepStyle(null));
    setClip(null);
    setBondOverlays([]);
    setSelRepOverlays([]);
    clearAllMeasurements();
  }, [clearAllMeasurements]);

  const measureCount = useMemo(
    () => (viewer?.ctx ? measurementCount(viewer.ctx) : 0),
    // measureVersion/primaryLoaded are the change signals: the manager's state is read imperatively
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewer, measureVersion, primaryLoaded],
  );

  const applyClip = useCallback(
    (mode: ClipMode, radius: number) => {
      if (mode === "off") {
        setClip(null);
        return;
      }
      const c = selectionInfo?.stats?.centroid ?? null;
      if (c) setClip({ center: c, radius, includeModel: mode === "all" });
    },
    [selectionInfo],
  );

  const clearSelection = useCallback(() => {
    setSel(EMPTY_SELECTION);
    setClip(null);
    setPopup(null);
  }, []);

  // --- bookmarks: load per entry; persist ONLY from the action callbacks (a
  // save-on-change effect would clobber storage with [] during the entry switch) ---

  useEffect(() => {
    setBookmarks(entry ? loadBookmarks(entry.pdbId) : []);
  }, [entry]);

  const addBookmark = useCallback(() => {
    const entryId = entry?.pdbId;
    if (!entryId || selectionIsEmpty(sel)) return;
    setBookmarks((prev) => {
      if (prev.length >= MAX_BOOKMARKS) return prev;
      const next = [
        ...prev,
        { id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`, createdAt: Date.now(), selection: sel, repStyle },
      ];
      saveBookmarks(entryId, next);
      return next;
    });
  }, [entry, sel, repStyle]);

  const deleteBookmark = useCallback(
    (bookmarkId: string) => {
      const entryId = entry?.pdbId;
      if (!entryId) return;
      setBookmarks((prev) => {
        const next = prev.filter((b) => b.id !== bookmarkId);
        saveBookmarks(entryId, next);
        return next;
      });
    },
    [entry],
  );

  // resurrect the SELECTION only. Bookmarks still store the RepStyle they were saved
  // with (schema unchanged), but applying one no longer touches the global style — a
  // bookmark saved under "atoms" used to silently switch the whole structure.
  const applyBookmark = useCallback((b: SelectionBookmark) => {
    setSel(normalizeSelection(b.selection));
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

  // a lane click or drag lands here as an author-keyed range; a shift-drag stays purely
  // additive (a sweep means "make sure this is selected"), a shift-click on one residue
  // toggles it like a 3D shift-click
  const onLaneSelect = useCallback((range: ResidueRange, opts?: { additive?: boolean; toggle?: boolean }) => {
    // same policy as the 3D canvas: the click that dismissed the popup is consumed
    if (dismissClickRef.current) {
      dismissClickRef.current = false;
      return;
    }
    if (opts?.toggle) {
      setSel((prev) => toggleResidue(prev, range.chain, range.from));
      return;
    }
    setSel((prev) =>
      opts?.additive
        ? normalizeSelection({ ranges: addRange(prev.ranges, range), atoms: prev.atoms })
        : { ranges: [range], atoms: [] },
    );
    if (!opts?.additive) setPopup(null);
  }, []);

  // right click in the lanes follows the same policy as a right click in 3D: the popup
  // always opens; with no live selection the residue under the cursor seeds it first
  const onLaneContext = useCallback((anchor: { x: number; y: number }, ref: ResidueRef | null) => {
    if (selectionIsEmpty(selectionRef.current) && ref) {
      setSel({ ranges: [{ chain: ref.chain, from: ref.seq, to: ref.seq }], atoms: [] });
    }
    setPopup(anchor);
  }, []);

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
        viewer.highlightLoci(visibleLoci(structure, residueLoci(structure, r.chain, r.seq)));
      });
    },
    [viewer, visibleLoci],
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

  // null with an empty selection — the popup still renders (mode toggles) without it
  const popupTarget: ActionTarget | null =
    residueRanges.length && selectionInfo
      ? {
          ranges: residueRanges,
          label: formatRanges(residueRanges, { maxSegments: 3 }),
          residueCount: selectionInfo.residueCount,
          splitCount: selectionInfo.splitKeys.length,
          letters: selectionInfo.letters,
          compId: picked?.compId,
        }
      : null;
  // a fresh popup opens with the sphere that just encloses the selection
  const popupClipRadius =
    clip?.radius ??
    (selectionInfo?.stats
      ? Math.min(40, Math.max(5, Math.ceil(selectionInfo.stats.fitRadius)))
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
      boxReady={!!box}
      slice3d={slice3d}
      onSlice3d={setSlice3d}
      sliceModel={sliceModel}
      onSliceModel={setSliceModel}
      sliceAxis={sliceAxis}
      onSliceAxis={setSliceAxis}
      sliceFrac={sliceFrac}
      onSliceFrac={setSliceFrac}
      sliceCoord={slicePlane?.point[sliceAxis] ?? null}
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
      selection={residueRanges}
      summary={selectionSummary}
      stateLetters={stateLetters}
      globalAlt={globalAlt}
      onGlobalAlt={setGlobalAlt}
      primaryLoaded={primaryLoaded}
      memberNums={ensembleInfo?.modelNums ?? []}
      memberIndex={memberIndex}
      onMember={setMember}
      bondRows={bondRows}
      bondsReady={bonds !== null}
      bondSummary={bondSummary}
      onBondHover={onBondHover}
      onBondFocus={onBondFocus}
      onResetAll={resetAll}
    />
  );

  return (
    <div className={`hetstar ${className ?? ""}`} style={{ height: "100%", width: "100%" }}>
      <div className="flex h-full min-h-0 flex-col bg-white text-[12px] text-ink-secondary">
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface-muted p-3">
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
            <EntryCard
              entry={entry}
              desc={entryDesc}
              aTable={aTable}
              altSummary={altSummary}
              memberCount={memberTables.length}
            />
          </aside>

          <div className="relative min-w-0 flex-1" onContextMenu={(e) => e.preventDefault()}>
            <MolstarViewer data={aText} binary={false} view={VIEW} onReady={setViewer} onLoaded={onPrimaryLoaded} />
            {/* faint scrim while the bundle loads: covers the fetch/table phase AND the
                window where Mol* is still parsing/building (loading is already false,
                primaryLoaded not yet true — the slow part for big ensembles) */}
            {!loadError && (loading || (!!aText && !primaryLoaded)) && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
                <div className={`flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-ink-muted ${CARD_SHELL}`}>
                  <Spinner className="h-3.5 w-3.5" />
                  loading model
                </div>
              </div>
            )}
            {pickMode === "measure" && (
              <div className={`pointer-events-none absolute left-2 top-2 z-10 px-1.5 py-0.5 text-[10.5px] text-ink-secondary ${CARD_SHELL}`}>
                {measureArm
                  ? `measuring from ${measureArm.comp} ${measureArm.chain}/${measureArm.seq} ${measureArm.atom}${measureArm.alt ? ` alt ${measureArm.alt}` : ""} — click the second atom`
                  : "measure: click two atoms"}
              </div>
            )}
            <div className="absolute right-2 top-2 z-10 flex items-start gap-1.5">
              <BookmarkTray bookmarks={bookmarks} onApply={applyBookmark} onDelete={deleteBookmark} />
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
              <div className={`pointer-events-none absolute bottom-2 left-2 px-1.5 py-0.5 text-[11px] text-ink-secondary ${CARD_SHELL}`}>
                {hoverInfo.compId} {hoverInfo.chainId}/{hoverInfo.authSeqId}
                {pickMode !== "residue" && hoverInfo.atomId ? ` ${hoverInfo.atomId}` : ""}
                {hoverInfo.altId ? ` alt ${hoverInfo.altId}` : ""}
              </div>
            )}
            {popup && (
              <SelectionActionsPopup
                anchor={popup}
                target={popupTarget}
                pickMode={pickMode}
                onPickMode={setPickMode}
                onBookmark={popupTarget && entry && bookmarks.length < MAX_BOOKMARKS ? addBookmark : null}
                bookmarkCount={bookmarks.length}
                conformersShown={popupShown}
                mutedLetters={selectionMutedLetters}
                onToggleLetter={toggleConformerLetter}
                densityReady={ready}
                clipMode={clip ? (clip.includeModel ? "all" : "density") : "off"}
                clipRadius={popupClipRadius}
                onToggleConformers={togglePopupConformers}
                onClip={applyClip}
                onClose={closePopup}
                onConformerSpread={spreadTargets.length ? addConformerSpread : null}
                bondsReady={bonds !== null}
                bondCount={selectionBonds.length}
                showBonds3d={bondsOverlayActive}
                onShowBonds3d={toggleBondsOverlay}
                selRep={selRepActive}
                onSelRep={setSelRep}
                measureCount={measureCount}
                onClearMeasurements={clearAllMeasurements}
                onResetAll={resetAll}
              />
            )}
            {showSlice2d && (
              <div className={`absolute bottom-2 right-2 z-10 w-[300px] p-1.5 ${CARD_SHELL}`}>
                <button
                  type="button"
                  title="close the 2D slice"
                  onClick={() => setShowSlice2d(false)}
                  className="absolute right-1.5 top-1 z-10 leading-none text-ink-muted hover:text-ink-secondary"
                >
                  {"×"}
                </button>
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
              </div>
            )}
          </div>

        </div>

        <div
          className="h-1.5 shrink-0 cursor-row-resize border-t border-line bg-surface-muted hover:bg-accent/30"
          onMouseDown={startLanesResize}
        />
        <div className="flex shrink-0 items-start bg-white px-3 py-2" style={{ height: lanesHeight }}>
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden">
            <SequenceLanes
              model={seqModel}
              aTable={aTable}
              confPlan={confPlan}
              secondaryByChain={secondaryByChain}
              metrics={laneMetrics}
              annotations={annotations}
              metricLanes={metricLaneModules}
              hoverRef={laneHoverRef}
              selection={residueRanges}
              onHover={onLaneHover}
              onSelect={onLaneSelect}
              onContext={onLaneContext}
              leading={
                <>
                  <span className="text-[11px] font-medium text-ink-muted">Sequence</span>
                  {residueRanges.length > 0 && (
                    <span className="flex items-center gap-1 rounded border border-accent/30 bg-accent-soft px-1.5 py-px text-[10.5px] tabular-nums text-accent">
                      {picked ? `${picked.compId} ${picked.chainId}/${picked.authSeqId}` : formatRanges(residueRanges, { maxSegments: 3 })}
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
        </div>
      </div>
    </div>
  );
}
