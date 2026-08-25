# Dynamic PDB visualization and metrics: scoping

Written 2026-08-20. Covers three things at once: what is actually in the Dynamic PDB dataset, what Mol* offers as infrastructure (with special attention to density maps), and the architecture we are building on top of both — the `@dynamic-pdb/hetkit` package (heterogeneity model + metrics + viewer bridges) and the density capabilities proven by the `/density-spike` route in this repo.

Companion artifacts, all in this repo unless noted:

- `packages/hetkit/` — the standalone package (model, metrics, viewer subpaths), tested against the real ETL samples.
- `app/src/lib/molstar/density.ts` + `app/src/app/density-spike/` — the density capability spike.
- `grouped_occupancies_v3.md` — the states/bundles mmCIF extension proposal (separate concern, but its categories are what `hetkit/model`'s `extensions` field parses).
- Sample data: `/Users/rtviii/dev/DYNAMIC_PDB_ETL/` (also copied into `packages/hetkit/test/fixtures/`).

## 1. Dataset profile

### The corpus

The incoming dataset is the qFit-at-scale output (thestacks.org/publications/qfit-at-scale): 60,549 structures completed out of 80,876 PDBRedo entries attempted (resolution 2 A or better, X-ray, deposited structure factors required, purely nucleic acid structures excluded). Median resolution 1.70 A, median size 298 residues. Per entry the pipeline produces:

- a re-refined single-conformer model (CIF),
- a qFit multiconformer model (CIF),
- a FASTA sequence,
- composite omit electron density maps.

So model-vs-model comparison is not an add-on; it is the shape of the data. Every entry arrives as at least a pair (re-refined single vs multiconformer), usually a triple (deposited as well), all refined against the same experimental data.

### What the sample files actually contain

The ETL drop currently holds five files: 7A1X (deposited + structure factors + qFit) and 9JD2 (structure factors + qFit; no deposited sibling). Findings that shape the tooling:

- Heterogeneity is altloc-based, single-model. Zero multi-MODEL files. A viewer built around MODEL-frame stepping targets the wrong axis; the unit of heterogeneity is the alternate-location group with continuous occupancies.
- Coverage is extreme by deposited-PDB standards. 7a1x_qFit: 88% of atoms carry an altloc; 93% of protein residues are multiconformer; three-way splits are the most common multiplicity. 9jd2_qFit: 58% of atoms, 47% of residues. An A/B toggle UI is inadequate; think n-way, n up to 5.
- Splits are per-atom, not per-residue. In 7a1x, 39 of 158 multiconformer residues split sidechain-only (backbone stays unsplit); in 9jd2, all 127 split backbone+sidechain. Conformer selection and coloring must operate on atoms.
- Hydrogen-only altloc letters exist. 7a1x residue A/102 (ARG) carries letters A-E, but only A-C appear on heavy atoms; D and E exist purely as alternative hydrogen placements. Per-residue heavy-atom multiplicity in that file tops out at 3. Metrics should define conformer multiplicity over heavy atoms (hetkit does), and any letter-count shown in UI should say which definition it uses.
- Occupancies are continuous refined values (0.007 to 1.0, hundreds of distinct values), not paired 0.5/0.5, and they sum to 1 within each (residue, atom name) altloc group — a good validation invariant (hetkit checks it with tolerance 0.02).
- Per-file inconsistencies the ETL and viewer must tolerate: hydrogens present (7a1x, 48% of atoms) or absent (9jd2); `_struct_conn` present or absent; deposited sibling present or absent; gemmi/Phenix two-space-indented CIF style vs RCSB column-0 style (line-position-based parsers silently fail on the former; Mol*'s parser handles both).
- No anisotropic B, no TLS, and no custom categories anywhere in the sample. The corpus expresses everything through stock `_atom_site.label_alt_id` + `occupancy`. TLS/aniso tooling therefore has no exercise data yet — if those stay in scope, we need samples that carry them.
- Density ships as reciprocal-space map coefficients inside the `-sf.cif` files (`_refln.pdbx_FWT/pdbx_PHWT` for 2mFo-DFc, `pdbx_DELFWT/pdbx_DELPHWT` for mFo-DFc). No real-space maps in the drop, though the corpus itself also has composite omit maps. 9JD2-sf carries a 22 MB unmerged `_diffrn_refln` loop (~90% of the file) that the browser never needs — strip on ingest.

## 2. Terminology

Worth pinning down because the team chat asked ("what is the difference between multiconformer and conformer models?"):

- Multiconformer model: ONE model in which discrete alternatives are encoded as altlocs with partial occupancies, all refined jointly against one dataset. qFit output. Alternatives are local (a residue, a segment); the rest of the structure is shared.
- Conformer of an ensemble: one complete structure among several (MODEL frames). NMR bundles, ensemble refinement. Each frame is a full copy; nothing is shared between frames at the file level.
- Continuous motion parameterizations: B-factors (isotropic spread), anisotropic ADPs (ellipsoids), TLS (rigid-body translation/libration/screw per group). These describe distributions around a position rather than discrete alternatives.

The corpus is almost entirely the first kind. The viewer targets all three (plus the proposed networks/states annotation layer on top of the first).

## 3. mmcif-browser tool inventory and generalization gaps

What exists today in `app/`, and what stands between it and arbitrary structures.

Already structure-agnostic (reusable as-is):

- `lib/molstar/queries.ts` — chain/residue/atom/entity/bond/surroundings MolScript builders.
- `lib/molstar/viewer.ts` core — plugin lifecycle, load, highlight/focus/selection, camera, hover/click subscriptions, screen projection.
- `lib/molstar/labels.ts` — DOM overlay labels.
- `lib/molstar/altloc-theme.ts` — the custom color-theme registration pattern (palette hardcoded A-E, though).
- Multi-structure tabs (`lib/tabs-store.ts`), the source inspector's click-to-3D machinery.

Hand-engineering hotspots (the generalization backlog):

- `lib/molstar/examples.ts` is the sole registry of what to render and how — hardcoded PDB ids, per-example blurbs, representation and animation choices. Nothing generalizes from it.
- `SourceInspector.tsx` assumes one physical line per `atom_site` row (breaks on wrapped rows) and its 3D linkage is a switch over 8 category names.
- `cif-source/fold-tree.ts` and `classify.ts` carry fixed category tables (fine as heuristics, but they are the only classification).
- `lib/molstar/het.ts` had an O(networks x members x atom rows) occupancy scan — fixed in the hetkit port (one-pass atom index); the app copy is unchanged for now and diverges until the Inspector migrates to the package.
- `wiggle-falloff.ts` computes distance shells brute-force over all atoms.
- Structure fetch is RCSB-only, text CIF only.
- `viewer.ts` mixes the generic core with TLS/heterogeneity domain state; the split into core + extensions is the main piece of the future viewer-core extraction.

The dynamic-pdb website (separate repo) already has its own 763-line Mol* `StructureViewer` with MTZ density layers and a hand-written periodic-map resample+carve (`expandMapAroundModel`). It is modal-only and has no per-residue anything, but it proves the codebase already reaches into Mol* volume internals.

## 4. Mol* infrastructure assessment

Verified against molstar 5.11.0 as installed (this repo bumped from 5.10.1; dynamic-pdb already resolves 5.11.0). The four density questions, answered:

### Can we slice?

Yes, natively. The `slice` volume representation has three modes: `grid` (axis-aligned, integer steps), `frame` (arbitrary axis, fractional offset, rotation), and `plane` (arbitrary point + normal). Colored by value through the `volume-value` theme. Additionally, every representation (volume or structure) accepts clip objects — plane, sphere, cube, cylinder, infinite cone, invertible, per-instance or per-pixel — so "cut the isosurface open" is a parameter update, not a feature request. The spike drives both (plane slice through a clicked residue; clip sphere around it).

### Can we stream density for just part of a volume?

Yes, two independent ways:

1. Volume streaming (server-backed). `InitVolumeStreaming` is registered by default in the plugin spec. Its `selection-box` view re-queries a box around the focused loci (radius parameter) on every focus change — exactly "density for the residue I am looking at". Query API is `{server}/{x-ray|em}/{id}/box/{a}/{b}?detail=N` against a VolumeServer; the default public instance is ds.litemol.org, and self-hosting runs the same server code PDBe runs (it preprocesses maps into a block store and serves box queries at multiple detail levels). This is the right long-term path for corpus-wide maps we host.
2. Serverless (client-side FFT). molstar 5.11.0 (2026-07-18) added structure-factor reading (SF-CIF and MTZ) plus an FFT in mol-math: `VolumeFromStructureFactorsCif` computes 2Fo-Fc and Fo-Fc grids in the browser from exactly the `pdbx_FWT/PHWT` / `pdbx_DELFWT/DELPHWT` columns our `-sf.cif` files carry. The data format provider id is `"sfcif"`; `provider.parse()` returns `{ volumes: { "2fofc": [...], "fofc": [...] } }` (same shape dynamic-pdb consumes for MTZ). The produced grids carry `periodicity: 'xyz'`, and 5.10+ wraps isosurfaces for periodic volumes, so the map follows the model across cell boundaries; per-residue restriction is then a clip sphere or a carve. Zero infrastructure needed.

The spike uses path 2 end-to-end: fetch 7A1X-sf.cif from RCSB, FFT client-side, isosurfaces at the dynamic-pdb parameter set (2Fo-Fc rel 1.5 sigma blue, Fo-Fc +3/-3 green/red), clip to clicked residue, slice on demand.

### Do we control voxel color / can we project a metric onto the density?

Yes, without forking. The load-bearing piece is the `external-volume` color theme (registered by default): it colors per VERTEX by trilinearly sampling ANY `Volume.Data` node in the state tree at the vertex position, with absolute/relative domains and color lists. Point it at a metric field and apply it to the 2Fo-Fc isosurface representation, and the density cloud is painted by the metric. Getting the metric field in as a volume is the alpha-orbitals pattern (a shipped extension computes quantum orbitals on a grid client-side and builds a `Volume` object literally): a small custom state transform that splats per-atom values onto a cartesian grid. The spike implements exactly this (`hetkit-metric-volume` transform + conformer-count field on a 1 A grid).

Two caveats found while verifying:

- `assign-color-volume` (the transform that attaches a `colorVolume` to a volume) is vestigial in 5.11 — nothing in the render pipeline reads `colorVolume` anymore. `external-volume` is the live mechanism; do not build on `assign-color-volume`.
- `external-volume` samples on the CPU per vertex (the source notes GPU sampling as a TODO), so re-coloring a large isosurface has a visible cost. Fine at spike scale; measure before shipping on huge maps.

Also available and relevant later: `direct-volume` rendering with a transfer-function editor (`controlPoints` LineGraph), `dot` and `segment` representations, format parsers for CCP4/MRC, DSN6, DX, Cube plus the DensityServer BinaryCIF schema, and the VolSeg extension (volumes-and-segmentations) for segmentation overlays.

### How hard are extensions?

Everything above is composition of existing primitives — parameter updates, one small custom transform, one theme application. No core Mol* changes were needed for any of the four capabilities. The real work is (a) the metric fields themselves and (b) UI that does not overwhelm.

## 5. Metrics catalog

The team brainstorm list, organized by what each metric needs and where it should be computed. "Client" means TypeScript in `hetkit/metrics` (interactive, works on whatever is loaded); "ETL" means precomputed offline (python/gemmi territory) and shipped as a per-residue track artifact. The two meet in the same `Track` interface (see section 6), so consumers never care which path produced the numbers.

Implemented now in `hetkit/metrics` (all residue-level, heavy atoms, tested on the ETL fixtures):

| id | input | what it is |
|---|---|---|
| conformer-count | model | distinct heavy-atom altloc letters (1 = unsplit) |
| occupancy-entropy | model | Shannon entropy (bits) of conformer occupancies |
| altloc-rmsf | model | occupancy-weighted RMS fluctuation of split atoms about their weighted centroid |
| b-iso-mean | model | occupancy-weighted mean isotropic B |
| model-rmsd | model pair | per-residue displacement between occupancy-weighted centroids of shared heavy atom names (no superposition; assumes a shared frame) |

Near-term, clearly specified, not yet implemented:

- RSCC / RSR / local density fit (model + map). The interface already expresses this (`model-map` input kind). Compute: needs model-derived density around each residue vs the experimental map. Honest versions belong in the ETL (gemmi/phenix conventions); a browser approximation (gaussian-atom model density vs FFT map, sampled on the map grid within a mask) is feasible for interactive what-if and should be validated against the ETL numbers before anyone trusts it. Q-score (cryo-EM) is the same shape.
- Per-conformer density support: RSCC computed per altloc letter — which conformers does the density actually support? This is the "compare which conformers fit different density states" item from the team notes, and it is just RSCC restricted to one letter's atoms.
- RMSF across an ensemble (`model-list` input): same formula as altloc-rmsf but over MODEL frames after superposition. Needs a superposition primitive first.
- lDDT / distance-difference matrices (model pair): superposition-free comparison; lDDT is per-residue (track-shaped), DDM is a matrix (needs its own display, not a track).

Further out, research-flavored (the "field does not have a standard yet" bucket from the open questions):

- Contact/H-bond changes across conformers: per-state contact graphs diffed between states or models. hetkit's `HetBond`/network machinery is the substrate once contacts are computed geometrically (nothing computes contacts today; `_struct_conn` is read, not derived).
- Correlated/concerted motion signals: which altloc groups co-occur. Within one file this is exactly what the states/bundles extension records (and what marginal occupancies underdetermine — see grouped_occupancies_v3.md); across models it is covariance of per-residue metrics.
- Conformational entropy / NMR-order-parameter analogues: aggregate per-residue occupancy entropy or angular spread of conformers.

Consuming UI per level: residue tracks feed the 1D strip and 3D color themes; model-level scalars feed the dynamic-pdb comparison table (which already displays R-work/R-free/CC/RSCC); pair metrics feed both (a track for the delta view, a scalar summary for the table).

## 6. Architecture

### Workspace and package

The repo is now an npm workspace: the Next app at `app/`, the package at `packages/hetkit` (`@dynamic-pdb/hetkit`, working name). One package with three subpath exports rather than three packages — the internals share residue keys and atom indexing, and subpaths keep import sites stable if it ever splits:

- `@dynamic-pdb/hetkit/model` — `parseCifText` (Mol* parser, handles both CIF styles), `buildAtomTable` (flat typed-array view of one model's atoms: coords, occupancy, B, altloc, auth keys, residue grouping), `summarizeAltlocs` (letters, per-residue multiplicity, full vs sidechain scope, occupancy-sum validation), `summarizeEnsemble`, `summarizeMotion` (TLS parse + aniso presence + B range), `parseHeterogeneity` (the extension categories, with the indexed occupancy scan), and `describeHeterogeneity` gluing them into one description covering all four heterogeneity kinds.
- `@dynamic-pdb/hetkit/metrics` — the `Track` type (metric id, level, unit, domain, keys, Float32 values with NaN for undefined), `trackToJSON`/`trackFromJSON` (the artifact-file path for ETL-precomputed tracks), `MetricDescriptor` with typed input kinds (`model`, `model-pair`, `model-map`, `model-list`), and the `METRICS` map. Plain data and functions; no registry machinery.
- `@dynamic-pdb/hetkit/viewer` — `trackColorTheme(track)`: a residue Track becomes a Mol* color theme provider (auth-keyed lookup per element, ColorScale over the track domain). This is the 1D-to-3D coordination primitive: the same Track drives the sequence strip and the structure coloring.

Mechanics: the package ships raw TypeScript through its `exports` map; both Next apps consume it via `transpilePackages` (no build step). molstar is a peer dependency. Tests are vitest (the only runner that transforms molstar's ESM-in-CJS-package `lib/` tree without ceremony), with the three model CIFs as fixtures — exact known-answer tests on synthetic inline CIFs, invariant tests on the real files.

Deliberate choice: the model layer reads raw CIF categories (through a narrow typed surface) rather than Mol*'s `Structure`/`Model` objects. It runs headless in node, survives Mol* internal drift, and the same `AtomTable` could later be produced by an ETL that never touches Mol*.

### The hybrid compute contract

A `Track` is data. `MetricDescriptor.compute` is one producer; `trackFromJSON` on a fetched artifact is another. The ETL precomputes expensive/canonical metrics for the 60k corpus and ships them as JSON artifacts next to the structure files; the browser computes cheap geometric metrics on the fly and can recompute interactively. Consumers (1D strip, 3D theme, tables, filters) only ever see Tracks. When an ETL-computed and a client-computed version of the same metric both exist, the ETL one is canonical and the client one is labeled approximate.

### End-state layout (not yet done)

`hetkit/viewer` eventually absorbs the generic core of `app/src/lib/molstar/` (viewer.ts core, queries.ts, labels.ts, themes) with TLS/het/wiggle as extension modules; the app keeps React shells and domain panels. The Inspector and proposal pages migrate to the package parsers (retiring the app's het.ts copy). That extraction is deferred until the package API stabilizes against real usage.

## 7. dynamic-pdb integration sketch

Where this lands in the website, when it lands (not part of this chunk):

- Mount point: the model page (`entries/[entryId]/models/[modelId]/page.tsx`) content column — a new structure section above `#validation`, viewer at full column width, per-residue tracks stacked beneath, the existing scalar tiles below as the summary. Everything the viewer needs (model file URL, map entities, entity list) is already in scope on that page.
- The existing `StructureViewer` keeps working during the transition; the spike's `density.ts` is deliberately parameter-compatible with it (same iso levels and colors). Its `expandMapAroundModel` carve may become unnecessary given periodic isosurface wrapping — verify visually, and keep the carve as fallback for hostile cases.
- Metrics storage: the DB metrics table is `(key, value numeric)` per model revision — scalars only. Per-residue tracks should ship as JSON artifact files in object storage (the artifact pattern already exists), fetched by the viewer and parsed with `trackFromJSON`. Promoting selected per-residue aggregates (mean RSCC, fraction multiconformer, mean altloc-rmsf) into the scalar table gives the comparison list sortable columns for free.
- Multi-model comparison: the entry page's `SortableModelList` is the comparison surface; per-column deltas and a baseline selector extend it. The 3D overlay comparison (2+ models superposed, RMSD threshold slider) is a viewer feature consuming `model-rmsd`-style pair tracks.
- The sequence strip: Mol*'s built-in sequence panel is the placeholder; the real 1D framework (annotation layers, zoom-to-range, metric tracks, coordinated coloring via `trackColorTheme`) is its replacement and the largest unbuilt UI piece.

## 8. Out of scope here, and open questions

Not in this chunk (deliberately): the viewer-core extraction; Inspector migration to package parsers; RSCC/RSR compute; ETL precompute scripts; dynamic-pdb consumption of hetkit; VolumeServer hosting; per-residue schema work in the dynamic-pdb DB; usage analytics.

Open questions carried forward from the team discussion, now with positions:

- Which metrics for single-model vs comparison? Single-model: conformer count, entropy, altloc-rmsf, B, RSCC (once available) — all shipped or specified. Comparison: model-rmsd now; delta-RSCC and lDDT next. The distribution-view question (raw vs delta vs baseline) stays open until the 1D framework exists to prototype it.
- Filtering dynamics by experimental support ("dynamic AND well-supported") is a two-track predicate (altloc-rmsf above X, RSCC above Y) — cheap once RSCC tracks exist; the Track interface was shaped so such combinations are trivial.
- Density + metrics in 3D without overwhelm: the spike's answer is opt-in layers (density off by default, clip-to-focus, metric projection as an explicit toggle). Whether metric-colored density reads better than metric-colored atoms is an empirical UI question to test on real users.
- Correlated motions: within-model, the states/bundles extension is our answer (and the proposal's whole argument); cross-model metrics are unexplored.
- TLS/aniso/ensembles: in scope for the viewer, absent from the corpus sample. Need exercise data before those paths harden.
