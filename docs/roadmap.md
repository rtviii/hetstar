# Roadmap: pair metrics projected into density

Started 2026-08-28, on confirmation of the metric slate proposed after the corpus recon
(`docs/corpus-recon-2026-08.md`). This file records the decisions as they are made and the
build progress. Update it when either changes.

## Confirmed scope

Compare TWO models of one entry against their shared experimental map, project per-residue
metrics onto the density, restrict the metric to a manually chosen scope (clicked residue,
residue range; arbitrary Mol* selection queries later), and view slices of density + metric
in a dedicated 2D panel (the in-scene slice plane alone is unusable). Corpus-scale ETL of
the same metrics is a separate later phase.

## Vocabulary (pinned 2026-08-28, after discussion)

"Comparing models" covers three distinct operations; the words below keep them apart.

- Conformer: ONE local alternative — an altloc letter's atoms at one residue or contiguous
  segment. Not a whole-structure object.
- Multiconformer model: ONE model in which local alternatives are encoded as altlocs with
  partial occupancies (qFit output; also most of the "re-refined" corpus class, which
  retains deposited altlocs). Deliberately NOT called a bundle: the file records only
  per-site marginals, so there is no well-defined "model A" spanning the structure —
  extracting one requires assuming same-letter co-occurrence across separated sites, which
  is an unenforced labeling convention, not data (the whole point of the states/bundles
  proposal in mmcif-browser).
- Ensemble: many complete MODEL frames (ensemble refinement, NMR). Here a whole-structure
  member IS well defined.
- Network / state / bundle: reserved for the grouped-occupancies extension's technical
  meanings (a named atom set constituting one alternative across residues; a co-occurring
  combination of networks with a joint occupancy; a group of correlated networks whose
  states enumerate a joint distribution). Do not use "bundle" loosely for "the altlocs of
  a multiconformer model" — it collides with that definition.
- The three comparison senses:
  1. WITHIN one multiconformer model, conformer vs conformer (state A vs state B at a
     site). Well-defined locally; only assumption-laden globally. Not in the current
     slate; the deferred per-conformer metrics (per-letter displacement, per-letter
     density support) live here.
  2. ACROSS two models of the same entry, one map: the current slate (displacement,
     RMSF delta, Fo-Fc tracks, support delta). Distribution-collapsing caveats apply
     (centroids absorb splits).
  3. DISTRIBUTION vs DISTRIBUTION: two multiconformer models, or multiconformer vs
     ensemble. Reduces each side to per-residue summaries first (RMSF vs RMSF, modality
     classifier); conformer-matching across models is the unsolved deliberation item.

Also pinned: in this corpus the qFit model is produced from the re-refined model (PDBRedo
then phenix re-refinement), not directly from the deposited one; "vanilla PDB" should be
said as either "deposited" or "re-refined" explicitly.

## The metric slate (confirmed)

1. `model-rmsd` — per-residue displacement between the pair (existing hetkit metric,
   occupancy-weighted centroids of shared heavy atom names, no superposition).
2. `altloc-rmsf-delta` — per-residue difference of altloc RMSF between the pair: where one
   model encodes more discrete heterogeneity than the other.
3. `fofc-mean` (+ `fofc-peak` from the same pass) — the Fo-Fc difference map sampled at a
   model's heavy atoms, occupancy-weighted mean signed value (and the signed value of the
   largest-magnitude sample), in sigma units. The evidence channel: each model's
   unexplained density.
4. `support-delta` — occupancy-weighted mean 2Fo-Fc (sigma units) at model A's atoms minus
   at model B's atoms, per residue: which model sits in more density. Labeled as support in
   the DEPOSITED map (its coefficients are phased by the deposited model; see recon doc
   section 3 for the bias caveat).

Added 2026-08-28 (user: "just provide knobs for this at first"): per-conformer density
support as a readout, not a track — for the picked residue, one row per altloc letter plus
a "shared" row for the unsplit atoms, each with occupancy, heavy-atom count, and the plain
mean of 2Fo-Fc and Fo-Fc (sigma units) at that row's atoms. Two knobs, both display-time:
"per unit occupancy" divides the map values by the row's occupancy (asks "how supported
would this conformer look at full occupancy", making letters comparable), and an occupancy
floor slider (default 0.2) that grays rows below it rather than hiding them — low-occupancy
conformers are essentially untestable against the map at these resolutions, and the gray
says so without deciding for the user. Implemented as hetkit `conformerSupport` (tested)
plus a table in the compare panel.

Deferred metrics and why: per-conformer displacement (needs a conformer-matching rule
across models — altloc letters do not correspond), RSCC/RSZD (needs a calculated-density
splat plus validation against gemmi; a crude masked-correlation proof of concept is
possible from existing pieces — see the deliberation notes), lDDT on multiconformer models
(distance definition unsettled: which letters' distance, and pair weights are exactly the
joint occupancies the file does not record), any cross-model B-factor metric (B semantics
differ per class; irrelevant to the current proofs of concept — nothing in the slate
touches B).

## Design decisions

Decided at confirmation time (defaults from the discussion, recorded here as binding until
revisited):

- Scope mechanism, v1: metrics are computed whole-model; scoping is a masking step
  (`scopeTrack`) that sets values to NaN outside the chosen residues before projection.
  At residue level this is exactly equivalent to computing on a subset and much simpler.
  The compute-over-atom-subset signature is deferred until an atom-level metric or a
  partial-residue scope actually needs it. Scope selectors in v1: whole model, clicked
  residue, chain + seq range. Insertion codes are ignored by the residue/range match
  (PickInfo does not carry them; revisit if an entry with them shows up).
- Map access for metrics: hetkit's `model-map` input takes a plain `(x, y, z) => number`
  sampler function, not a Mol* Volume. This removes the Mol* type coupling from the
  metrics layer (the old declared-but-unused `model-map` shape imported Volume) and makes
  map metrics testable headless with synthetic samplers. The viewer side constructs the
  sampler from a volume ref.
- Sampling correctness: Mol*'s `Grid.makeGetTrilinearlyInterpolated` does NOT wrap indices
  for periodic grids (verified in 5.11 source — the periodic branch only skips the bounds
  check, so out-of-cell positions read wrong voxels). We therefore sample with our own
  wrapped trilinear interpolation (the carve's `sampleWrapped`, now exposed as
  `makeGridSampler`), against the PRISTINE full-cell grid.
- Pristine grid stash: `carveGridAroundStructure` now stashes the original periodic grid
  on the volume object (`_hetstarSourceGrid`) before replacing it. Samplers read the
  stash, so metric sampling and the slice panel see full-cell periodic data at native FFT
  resolution regardless of carving (this also unblocks the old lab step 1, per-residue
  carve, later). Sigma units use the full-cell stats, which both grids share.
- Map values in sigma units (relative to full-cell mean/sigma) everywhere a human sees
  them; metric tracks store sigma-unit values directly.
- Occupancy weighting: map sampling aggregates over heavy atoms weighted by occupancy, so
  a split residue's alternates contribute in proportion to their modeled population.
- Splat source for pair metrics: the union of both models' heavy atoms (each atom carries
  its residue's metric value); single-model metrics splat from that model's atoms only.
- NaN discipline: masked/undefined residues carry NaN; the splat leaves voxels with no
  contributing atoms at NaN; the external-volume theme maps NaN samples to its
  defaultColor (verified in source), set to the same missing-gray (0xcfd8dc) hetkit's
  track theme uses. This fixes the old collision between "value 0" and "no data".
- Color ramps per metric, shared between the 3D projection and the 2D slice panel:
  sequential light-gray to orange to dark-red for model-rmsd (domain [0, max]); diverging
  blue-white-red for altloc-rmsf-delta and support-delta (symmetric domain, red = A
  higher/better-supported); diverging red-white-green for the Fo-Fc tracks, matching the
  Fo-Fc isosurface colors (negative red, positive green). The 2D panel approximates the
  same stops with its own ramp code.
- Domains: deltas and signed metrics get symmetric domains around 0 (max-abs); scoping
  does NOT rescale the domain (colors stay comparable when the scope changes).
- The demo pair, v1: model A = 7A1X qFit multiconformer (local `/spike/` copy), model B =
  7A1X deposited (hetkit fixture copied into `/spike/`). Both are CIF, so both feed
  hetkit's parser and Mol* directly. The re-refined `final_model` PDBs need either a PDB
  parser in hetkit or CIF conversion on ingest — deferred, noted in the corpus doc.
  Model B renders as uniform slate ball-and-stick; model A keeps alt-loc coloring.
- Two-model loading: a `loadSecondary` method on the viewer that adds a second
  parse-model-structure-representation chain to the same state tree without touching the
  primary load/clear lifecycle or the frame-scrubbing refs. Visibility toggled per model
  via subtree visibility.
- Slice viewer: a dedicated 2D canvas panel, NOT a Mol* render. For a plane (axis-aligned
  normal + position slider in v1), it samples the density grid (wrapped, pristine) and the
  metric grid (bounded) on the same 2D lattice: density as grayscale, metric as color,
  overlay mode drawing metric color over density luminance. Hover shows numeric density
  sigma + metric value. The in-scene slice representation is kept only as an optional
  positioning aid, synced to the same plane. Contour lines (marching squares) deferred.
- The clip sphere doubles as a "clip density to scope" toggle when the scope is a clicked
  residue (existing setClipSphere, radius 5 A around the residue centroid).
- All of this lands on a new `/compare-lab` route; `/density-lab` (step 0) and
  `/density-spike` stay untouched until compare-lab covers them.

Added 2026-08-28, second discussion round:

- Letter correspondence, FOR NOW: cross-model per-conformer metrics ASSUME same letter =
  same state (A matches A, B matches B). This is explicitly a working assumption, not a
  fact — letters are labels, and the real coupling mechanism is what the states/bundles
  proposal will eventually provide; there is no platform to record correspondence yet.
  Every per-conformer cross-model number ships with this label until then.
- Unsplit residues and shared atoms in per-conformer comparisons: blank-altloc atoms
  belong to EVERY state (that is standard altloc semantics — a blank coexists with any
  letter), so an unsplit residue participates in an A-to-A comparison through its single
  position; no special-casing. Within-model spread metrics come out 0 there naturally
  (altlocRmsf already does), which is the true value. Forced zeros are wrong only for the
  genuinely undefined case (residue absent from the other model, no valid map samples):
  there the value is NaN and renders as the missing-gray, because on these scales 0 is a
  meaningful reading ("compared, found equal / no error") and must not be conflated with
  "not applicable". The NaN machinery already exists; this bullet just pins the
  convention.
- Model-calculated maps are a gemmi job, ETL-side (not cisTEM — that is cryo-EM
  single-particle software; for X-ray model maps the tools are gemmi or phenix). Planned
  gemmi phase, per entry/class: compute Fc from each model (sfcalc), produce per-class
  2mFo-DFc / mFo-DFc coefficients (removing the deposited-model phase bias), compute
  canonical per-residue and per-conformer RSCC/RSZD as Track JSON, and optionally emit
  model-vs-model Fc-difference coefficients as sf-cif so the existing browser FFT stack
  renders them unchanged. The browser masked-correlation RSCC stays the interactive
  approximation, validated against these numbers.
- B-factors, noted and parked: B means different things per class (single-position models
  absorb all disorder into B; qFit co-refines B with occupancies, so they trade off;
  ensemble refinement moves motion into the frame spread). Consequences: no cross-model
  B-difference metrics without explicit framing, and calc-density widths use B only
  WITHIN one model (which is legitimate). None of this touches the current base layer;
  revisit when a B-derived metric is actually proposed.

Added 2026-08-28, third session (the compare-lab UI rework):

- Layout, pinned by the user from the annotated screenshot: left column = loader +
  per-file provenance + selection info (the conformer-support table moves there); right
  column = density layer controls + the metric toolbar; bottom strip spanning the full
  width = per-residue conformer barplot + the slice panel. The 3D canvas keeps the
  center.
- Entries: 7A1X and 9JD2 only, through a registry (app/src/lib/lab/entries.ts). The
  colleagues' full archive exists but local copies would run around 300 GB, so
  arbitrary-ID loading is scratched for now. RCSB serves deposited mmCIF and sf-cif
  with open CORS (verified live; HEAD returns 403 but GET works), so an additional
  entry is one registry row — its deposited model and structure factors download at
  load time.
- Ghost styling: ghost STICKS, not cartoons (user choice). The tubulinxyz recipe, of
  which the postprocessing half (outline with includeTransparent, occlusion, white
  background, ignoreLight) was already in style.ts byte-for-byte; the added ingredients
  are renderer.pickingAlphaThreshold 0.1 (translucent sticks stay hoverable and
  pickable), per-loci transparency via setStructureTransparency — NOT typeParams.alpha;
  layers merge later-shadows-earlier and a value of 0 is a real opaque layer — and the
  pastel base pair (model A 0xb8c4d0 cool blue-gray at 0.55, model B 0xd4c4a8 warm
  beige at 0.75) with saturated color arriving only as overpaint.
- Single-conformer collapse at load (user-confirmed rule): per altloc residue keep the
  highest-occupancy letter (NaN occupancy counts as 0, ties resolve to the first
  letter) plus all blank-altloc atoms. Rendering stays ONE ball-and-stick
  representation per structure; non-kept letters hide behind a transparency-1 layer and
  expanded residues recolor per letter by overpaint — the mmcif-browser lesson that
  splitting conformers into separate components leaves cross-component bonds undrawn.
  Implemented in app/src/lib/molstar/conformers.ts; the layer order ghost 0.55 then
  accent 0 then hidden 1 is load-bearing.
- Mol*'s default click behaviors are REPLACED, not hidden: labViewerSpec authors the
  behaviors array and omits Representation.FocusLoci plus StructureFocusRepresentation
  (the click-focus "neighborhood" sticks), Camera.FocusLoci (the camera fly), and
  DefaultLociLabelProvider (the hover toast; a small app overlay replaces it). The
  mouse trackball is canvas3d-internal, not a behavior, so dropping
  Camera.CameraControls costs only keyboard shortcuts. Other routes keep viewerSpec
  and their default behaviors unchanged.
- Selection model: the app's picked residue is the single source of truth and the navy
  accent IS the selection marking (no Mol* selection-manager involvement, avoiding the
  selectionMode gate and the green tint). Left click sets it, empty-space click clears
  it. Right click opens the Selection Actions Panel from the last hover, triggered by
  the right-mousedown/mouseup distance pattern (under 5 px = click, more = camera drag)
  because onContextMenu fires on mousedown on macOS; the native menu is only
  suppressed. Panel actions: show/collapse conformers, density within an editable
  radius (default 5 A, sphere clip at the residue centroid — still a clip, not a
  carve), set as metric scope, clear.
- Slice-the-model mechanism (answering "can this even be done in Mol*": yes): clip is
  a base-geometry param on every representation, so structure representations take the
  same pixel-variant clip objects as the density ones. clipPlaneObject encodes the
  plane the way the shader expects — un-rotated normal +Y, reoriented by an axis/angle
  rotation; invert false discards the +normal side. Objects in one array combine as
  union-of-discards, so the residue sphere (keep inside) and the slice plane compose
  to the intersection of kept regions. The in-scene slice-plane representation is
  excluded from the clip so it stays visible at the plane.
- Metric metadata single-sourced: labels, units and formula text come from hetkit's
  METRICS registry; the app keeps only rendering fields (ramps, pair/map input needs,
  toolbar button text) and builds the toolbar tooltips by interpolating the
  actually-loaded file URLs. altloc-rmsf-delta is composed app-side from two
  altloc-rmsf runs. The panel-side METRIC_DEFS duplication is deleted.
- Loading is staged and automatic: models, tables, sf-fetch, FFT, carve, isosurfaces
  in order, each a status dot in the loader; a density failure leaves the models
  browsable with a retry; every file lands a tiny-text provenance line (source URL or
  local path plus what it is). The separate "load density" button is gone.

Added 2026-08-28, fourth session (operability pass on the compare-lab UI, from the user's
screenshot review):

- Model A is now CONCRETE, not a ghost: opaque warm sand (`MODEL_A_COLOR` 0xc4b590 — the
  muted version of the crystallography-standard warm-model-under-blue-map convention),
  with the ghost transparency layer deleted from `applyConformerStyling` (the layer stack
  is now just hidden-letters 1 + overpaint accents). Model B swaps to the cool blue-gray
  ghost (0xb8c4d0 at 0.75) and is HIDDEN by default — the page opens on one solid
  single-conformer model under density. `GHOST_A_COLOR`/`GHOST_TRANSPARENCY` are gone.
- Density never intercepts picking: volume representations (isosurfaces and the in-scene
  slice) get `repr.setState({ pickable: false })` right after creation
  (`setReprsPickable` in density.ts). Pickability is per-instance representation state,
  not a state-tree param; the instance survives param updates (sigma slider), so setting
  it once holds. This fixes both "right click can't get through the density to the
  residue" and left-clicks on density clearing the selection.
- Selection Actions Panel restyled as buttons + sections: conformer letter CHIPS colored
  from the same `AltColors` the 3D overpaint uses (`altColorCss`; chips light up when the
  conformers are shown, so the panel doubles as the legend), a "clip around residue"
  section with an off / density / density + model segmented switch and a DRAGGABLE radius
  slider (2-20 A, live re-clip while dragging), and "set as metric scope". "clear
  selection" moved out of the panel entirely. The density+model mode feeds the same
  clip-sphere object to the structure representations (both models) that the density
  reprs get — clip is a base-geometry param, so one object works everywhere.
- Barplot drag = range selection: dragging on the conformers-per-residue strip selects a
  residue range (clamped to the chain the drag started in), navy-overpainted in 3D
  (`selectedRange` in `ConformerStyleState`, `buildResidueQuery` over the range) and
  auto-set as the metric scope (mode "range" + chain/from/to fields). A single click
  still picks one residue. The current selection (residue or range) renders as a chip
  with a clear cross next to the barplot header — the one place selection is cleared.
- Master density toggle as an overlay button on the canvas (top right): gates BOTH maps'
  visibility on top of the per-layer checkboxes, which keep their state.
- The per-conformer support table's conf column carries the letter color chips too.
- Slice panel: honest aspect ratio (CSS aspect-ratio from the sample lattice instead of
  a squashed max-height), higher sampling (320 wide, 240 cap), smoothing instead of
  image-rendering pixelated. "metric" mode now always renders the density grayscale as a
  washed-out base wherever the metric field has no data — previously a residue-scoped
  metric drew a tiny splat in a blank gray box, which read as broken.
- Loader panel slimmed: per-file provenance and the finished pipeline stages fold into a
  "sources" tooltip next to the Entry header; the stage dots render only while a load is
  in flight or failed.

## Build progress

Steps in the confirmed order. Mark with date when done; "verified" means the user checked
visuals in their running app (typecheck/tests are the machine gate, not the visual one).

1. [x] 2026-08-28 hetkit: `trackDelta`, `scopeTrack`, map-sampler metrics
       (`mapValueTracks`, `mapSupportDelta`), registry entries, `model-map` input
       re-typed to sampler; synthetic tests (23 total, green).
2. [x] 2026-08-28 app: pristine-grid stash + `makeGridSampler` in carve.ts; NaN-aware
       splat and color-list/defaultColor options in density.ts.
3. [x] 2026-08-28 app: `project.ts` — `samplerForVolume`, `trackToPoints`,
       `MetricProjector` (create/re-color/dispose lifecycle; serialized in the panel).
4. [x] 2026-08-28 viewer: `loadSecondary` (second structure, uniform slate, mmcif/pdb
       format option).
5. [x] 2026-08-28 `/compare-lab` route + CompareLabPanel: pair loading (qFit primary,
       deposited secondary from the fixture copied to `public/spike/7A1X.cif`), density
       load/carve, metric selector with per-metric ramps and blurbs, scope controls
       (all / clicked residue / chain range), clip-to-scope, status line. Projection is
       gated on density being loaded (its target is the 2Fo-Fc surface).
6. [x] 2026-08-28 SlicePanel: 2D canvas slice (density grayscale, metric ramp, overlay),
       axis radio + position slider, hover readout with numeric sigma/metric values,
       optional 3D plane sync via the existing slice representation.
7. [x] 2026-08-28 `npx tsc --noEmit` clean (app and hetkit) and `npm test` green (23).
8. [x] 2026-08-28 per-conformer support readout with knobs (occupancy-normalize toggle,
       floor slider) in the compare panel; hetkit `conformerSupport` + test (24 green,
       both typechecks clean).
9. [ ] User visual check on /compare-lab; then decide what graduates into /density-lab
       and what the next step is (candidates: crude masked-correlation RSCC proof of
       concept, per-conformer displacement under the letter-correspondence assumption,
       scoped carve using the stashed grid, arbitrary-normal slice, Mol* selection-query
       scope, fofc tracks for model B, the re-refined PDB as model B via pdb parsing).
       2026-08-28, third session: the check now covers the reworked page (steps 11-16).
10. [ ] gemmi ETL phase (offline, python): per-class Fc and 2mFo-DFc, canonical
        RSCC/RSZD tracks, Fc-difference maps as sf-cif (see the decision bullet). First
        target: the two demo entries, then the divergence cohort from the corpus doc.
11. [x] 2026-08-28 viewer plumbing for the rework: labViewerSpec (authored behaviors,
        viewport controls stripped) and a ViewerVariant ("default" | "minimal" | "lab")
        init path threaded through useMolstarViewer/MolstarViewer; lab renderer props
        (pickingAlphaThreshold 0.1, light-blue highlight, dimStrength 0); PickInfo
        gains altId and insCode; the primary structure ref is tracked so styling can
        target its components; pastel palette constants in style.ts; globals.css Arial
        override replaced with the Geist font variables.
12. [x] 2026-08-28 ghost/collapse engine: app/src/lib/molstar/conformers.ts
        (planConformers, applyConformerStyling, applySecondaryGhost,
        componentsForStructure / representationRefsForStructure); AltColors exported
        from altloc-theme; the compare-lab base representation switched from the
        alt-loc theme to uniform pastel.
13. [x] 2026-08-28 clip generalization in density.ts: clipSphereObject /
        clipPlaneObject / setClipObjects, with setClipSphere and clearClip kept as
        one-line delegates so /density-spike is untouched.
14. [x] 2026-08-28 interaction rebind on /compare-lab: left click selects (and only
        selects; empty space clears), right click opens SelectionActionsPopup, a hover
        readout overlay replaces the Mol* toast; densityClip state (centroid + variable
        radius from the panel) replaces the fixed clip-to-picked-residue checkbox.
15. [x] 2026-08-28 layout rework: CompareLabPanel reduced to state + orchestration; new
        components/lab/compare/{ui, metrics, LoaderPanel, SelectionPanel,
        DensityControls, MetricsToolbar, ConformerBarplot, SelectionActionsPopup};
        staged auto-loading with per-file provenance; conformer barplot with two-way 3D
        sync and chain boundaries; SlicePanel compacted into the bottom strip alongside
        the "plane in 3D" and new "slice model" checkboxes; the hardcoded 7A1X
        constants, density button and METRIC_DEFS blurbs deleted; 9jd2_qFit_010.cif
        copied from the hetkit fixtures into app/public/spike/.
16. [x] 2026-08-28 machine gates for the rework: npx tsc --noEmit clean in app and in
        hetkit, npm test green (24; hetkit source untouched). Visual verification
        pending (step 9).
17. [x] 2026-08-28 fourth-session operability pass (see the decision block above): solid
        model A / hidden ghost B, non-pickable density, popup restyle with letter chips
        and the off/density/density+model clip, barplot range selection + selection
        chip, master density toggle, slice-panel aspect/resolution/metric-mode fixes,
        loader provenance folded into a tooltip. npx tsc --noEmit clean. Visual check
        pending (step 9 covers it).
