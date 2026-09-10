# The full corpus drop: recon, conformer landscape, and ideas

Written 2026-08-28, before the next development session. The colleagues shared the whole
dataset, which answers the question the density-UI handoff carried ("does DYNAMIC_PDB_ETL
still hold the five files?") emphatically: it now holds the corpus. This doc records what is
actually in the drop (superseding the "five files" paragraph of scoping section 1), what
kinds of conformers the corpus contains, and a grounded set of ideas for metrics and for
density-projected representations now that the projection mechanism is proven. Numbers come
from scripted analysis of the metric tables plus a 401-file uniform sample of the PDBs
(scripts were run in a scratchpad and are reproducible from the descriptions below; nothing
was added to the repo). Sources: `docs/dynamic-pdb-scoping.md`, `docs/spike-rehoming.md`,
`docs/HANDOFF_density_ui.md`, the mmcif-browser proposal documents, and the hetstar code as
of `a063fc7`.

## 1. What DYNAMIC_PDB_ETL now contains

Three model classes per entry, all refined against the same deposited structure factors,
from the Wankowicz lab PDBRedo pipeline (the paths in the logs say
`wankowicz_lab/PDBRedo/pdb-redo3/...`):

- `final_model/` — 49,626 files `<pdbid>_020.pdb`, 17 GB, plus 47,481 phenix.refine logs.
  These are the re-refined models (the zip is named `deposited_rerefeined`); `_020` is the
  phenix.refine serial. Heavy atoms only, purely isotropic B (zero ANISOU records in the
  sample, notable since a quarter of the files are at 1.4 A or better), resolution median
  1.70 A with 95% at or below ~1.95, median 306 protein residues, median one chain, heavily
  solvated (median 357 waters). This is the only class whose coordinate files are local.
- qFit multiconformer models — tables only. `combined_qfit_rfree.csv` has 59,588 entries
  (6,709 with R-free but no R-work), the structure table 57,957. The model files themselves
  are NOT in the drop; locally we still have exactly two (`7a1x_qFit_010.cif`,
  `9jd2_qFit_010.cif` at the drop root, mirrored in hetkit fixtures).
- Ensemble refinement models — tables only. `ensemble_refinement_metrics.csv` has 58,733
  rows of which 14,550 (24.8%) are all-NA (failed or unharvested runs; 5,929 of those
  nonetheless have a final_model PDB, so harvesting lags the files). Structure tables cover
  only batches 1_3, 4, 7_9 (24,707 IDs); the software tables cover all five batches. The
  ensemble coordinate files are NOT local either.

Set overlaps, for planning joins: ensemble-and-qFit 41,443 entries; the triple intersection
(qFit table, numeric ensemble metrics, final_model PDB present) is 32,075, and 26,486 of
those have numeric ensemble metrics for paired comparison. 442 final_model IDs appear in
neither table.

Content profile (matches the qFit-at-scale selection): 88% of entries carry at least one
non-water ligand, but the frequency list is dominated by buffer and cryoprotectant
chemistry — SO4, GOL, CL, EDO, ZN, MG, CA, NA, ACT, DMS, PO4 — with HEM the top genuine
cofactor and NAG/MAN/BMA marking glycosylation. MSE, SEP, TPO in the ligand columns are
modified residues, not ligands; any "has ligand" predicate should exclude them along with
the buffer set. Space groups are the usual protein suspects (P 21 21 21 first everywhere).

Data-quality flags to carry into any ETL: the 14,550 all-NA ensemble rows; 6,709
R-free-only qFit rows; 5,240 PDBs without logs and 3,095 logs without PDBs; 67
structure-table rows with zero atoms and residues; five negative Wilson B values; two
ensemble-table rows mislabeled "Multiconformer"; a few files at peptide scale (down to 6
residues) and B-factor outliers (per-file mean B from 2.9 to 66, max B up to 605).

## 2. The conformer landscape

What kinds of conformers are in the corpus, per class:

The qFit class is as scoping section 1 described from the two samples: single-model,
altloc-encoded, n-way with n up to 5 letters (3-way commonest in 7a1x), splits per-atom
rather than per-residue, occupancies continuous and summing to 1 per altloc group.
Nothing in the new tables contradicts that profile; the structure table confirms "Model
Type: Multiconformer" throughout and atom counts (median ~7,100) consistent with partial
duplication of a ~300-residue model.

The ensemble class is multi-MODEL in the classic sense and its size is not a free
parameter: ensemble_size takes quantized values {25, 29, 34, 40, 50, 67, 100, 200} with
median 67, and correlates with resolution at r = -0.52 — the phenix.ensemble_refinement
protocol assigns more members at higher resolution (median 1.22 A for the 200-member tier,
1.90 A below 50). Median file size is 176,000 atoms and the maximum 3.16 million, which is
why the coordinate files did not travel and why "fetch the ensemble" cannot be the default
viewer path. Any per-frame metric on these is partly a protocol readout (size tier, pTLS)
and must be resolution-stratified before cross-entry comparison.

The surprise is the "single-conformer" class: it is not single-conformer. In the 401-file
sample, 72.8% of final_model PDBs retain altlocs (independently spot-checked at 41/50 on a
different stride). The typical altloc file has a low fraction of split atoms (median 3.8%,
interquartile roughly 1.5 to 8%), mostly two-way (multiplicity 2 in 256 of 292 altloc
files, 3 in 31, 4 in 3, letters A through D), i.e. the deposited model's alternates
survived re-refinement. But the tail is extreme: 5qeq is ~98% altloc atoms, 1w2v ~58% —
effectively whole-model two-copy ensembles filed as re-refined singles. Two files carry
single-letter partial-occupancy labels with no paired alternate. Alternate waters and
ligands also carry letters, so atom-fraction denominators need care. Consequences: every
"single vs multiconformer" comparison needs a declared collapse rule (e.g. keep the
highest-occupancy conformer) applied consistently, hetkit's altloc metrics are meaningfully
nonzero on this class too (which is an opportunity: the metrics run on local data today),
and our own docs should stop calling the class single-conformer — "re-refined" is the
accurate name.

Also settled by the drop: hydrogens absent (final_model is heavy-atom only; the qFit
fixtures differ per file as before), TLS and anisotropic B still absent corpus-wide, so
those viewer code paths remain without exercise data. Ensembles now exist as exercise data
in principle, but remotely.

## 3. Fo, Fc, and the two maps, plainly

Answering the question in `q_next_steps.md` directly, because the density UI keeps using
these names.

A diffraction experiment measures, for each reflection (a direction hkl), an amplitude
|Fo| — "F observed". It does not measure the phase of that reflection, and without phases
you cannot compute a map. The phases have to come from somewhere, and in refinement they
come from the current model: from the model's atoms you can calculate both amplitude and
phase for every reflection — that calculated quantity is Fc.

A map is a Fourier transform of (amplitude, phase) pairs. The three obvious choices:

- Fc amplitudes with Fc phases just reproduces the model you already have. Useless as
  evidence.
- Fo amplitudes with Fc phases is the honest "observed" map, but because the phases are the
  model's, features the model lacks show at roughly half their true height, and features
  the model wrongly contains still show at half height. The map is biased toward the model.
- Fo-Fc amplitudes (difference of observed and calculated) with Fc phases is the difference
  map: to first order it shows what the data contain that the model does not (positive
  peaks, conventionally green) and what the model contains that the data do not (negative,
  red). Contoured at plus and minus 3 sigma because you only care about strong disagreement.

2Fo-Fc is the practical fix for the bias in the second map: 2Fo-Fc = Fo + (Fo - Fc), the
observed map plus one full dose of the difference map. The half-height errors get topped up
to roughly full height, so missing atoms appear and wrong atoms fade, while correctly
modeled regions look like the ordinary map. It is the everyday "where is the density" map,
contoured around 1 to 1.5 sigma. What the sf-cif files actually store (pdbx_FWT/PHWT and
pdbx_DELFWT/DELPHWT) are the refined-weighted versions, 2mFo-DFc and mFo-DFc, where m
downweights reflections with unreliable phases and D compensates model errors — the same
two maps, just statistically weighted, which is why the spike's FFT gives standard-looking
maps without further processing.

One consequence worth keeping in mind corpus-wide: the deposited map coefficients were
phased by the model that was deposited with them. Comparing how well a qFit model, an
ensemble, and the re-refined model "fit the density" using those coefficients quietly
favors whichever model most resembles the phasing model. For per-entry inspection this is
fine (label it "support in the deposited map"); for honest cross-class claims the ETL must
recompute 2mFo-DFc per model class (gemmi or phenix territory).

## 4. Density-projected representations: what the proof unlocks

The proven chain is: per-atom values splatted to a grid via the `hetkit-metric-volume`
transform, any representation colored by trilinearly sampling that grid via the
`external-volume` theme, exercised end-to-end on the 2Fo-Fc isosurface with the
conformer-count track. Everything below composes from that plus the existing carve, clip,
and slice machinery. Ordered by how little new plumbing each needs.

Compose today, near-zero new code:

- Fo-Fc residue tracks. Sample the already-FFT'd Fo-Fc grid at each residue's heavy-atom
  positions (the periodic-aware trilinear sampler exists): mean signed value, max absolute
  peak, fraction of atoms in negative density. That is the first real `model-map` metric —
  the input kind hetkit declares but never implements — and it needs no new infrastructure
  at all: the volume and the atom table are both in memory in the running viewer. It feeds
  the sequence strip, structure coloring, and a "worst-explained residues" sort key, and it
  gives every other density idea its error channel.
- Generic track projection. The residue-track-to-MetricPoints flattening currently lives
  inline in the spike panel, hardcoded to conformer-count and the 2Fo-Fc repr, with the
  metric volume cached forever. Promote it to one hetkit/viewer call
  (track in, splat params and target repr in, volume ref managed with invalidation), and
  make the splat NaN-aware: empty voxels should carry NaN and map to the theme's missing
  color, not 0 — today a genuine value of 0 (entropy of an unsplit residue) is
  indistinguishable from "no data here". After that, every metric in the registry and every
  ETL-shipped track is density-paintable through the same call.
- Metric-colored slices. Slices are representations too; the same theme swap that colors
  the isosurface colors a slice plane. A density slice paired with a metric slice through
  the same plane shows interior density that isosurfaces occlude, annotated by
  heterogeneity. The slice representation already supports arbitrary point-plus-normal;
  the UI only exposes axis-aligned so far, and "normal = current view direction" is
  probably the first non-axis preset worth having.
- Scoped carve. Already queued as lab step 1 (with the known pristine-grid-stash problem).
  Worth framing bigger than a feature: the residue-scoped carve is the scope primitive that
  every representation above should respect — one scope control driving carve extent, clip,
  and which model class is visible, exactly the layer/scope sketch in the handoff agenda.

One new seam each:

- Additive splat mode. The current splat is a Gaussian-weighted average — correct for
  fields like "conformer count here", wrong for anything accumulative. An additive mode
  (sum of occupancy-weighted contributions) turns the same transform into a model-density
  builder: splat all altloc letters weighted by occupancy and you get a cheap "where the
  model puts matter" field to hold against the experimental map.
- Per-altloc density partition. One small field per altloc letter of a focused residue,
  used to color the scoped carve: which lobe of the local density belongs to A and which to
  B, and is there density for both. Note this applies to the re-refined class too, not just
  qFit, since 73% of those files carry altlocs.
- Disagreement painting. modelRmsd (which exists) between two classes of the same entry,
  projected onto the shared 2Fo-Fc surface: density lobes light up where the models place
  atoms differently. The same-frame assumption modelRmsd makes holds here by construction,
  since all classes are refined in the same cell against the same data. Combined with the
  Fo-Fc track you can see whether model disagreement co-locates with map error — that
  co-location is the corpus's central question rendered as one picture.

Needs data or ETL first:

- Ensemble support field. Splat all frames of an ensemble into fraction-of-frames-per-voxel
  (additive mode prerequisite) and either render it as its own "model density" ghost
  surface next to 2Fo-Fc or paint 2Fo-Fc by it — the readable summary of 67 frames, and it
  exposes observed density the ensemble never occupies. Needs the ensemble files (below)
  and probably a worker or ETL precompute at 100-plus frames.
- Difference-of-model maps as sf-cif. The elegant ETL trick: gemmi can compute Fc
  coefficient sets per model class and write Fc(qFit) minus Fc(ensemble) as an sf-cif file;
  the existing sfcif provider then FFTs it and the whole carve/clip/slice/color stack
  consumes it with zero viewer changes. The sf-cif format is the interchange seam we
  already proved.
- Same-map three-model compare as the flagship view: one map, one carve, the three classes
  as toggle or blink under a shared sigma slider, clip, and scope. All the mechanisms
  exist; what is missing is the qFit and ensemble files for entries beyond 7A1X/9JD2.

Known costs to respect: external-volume samples per vertex on the CPU (fine at spike
scale, unprofiled beyond), the carve mutates the volume grid in place (step-1 problem),
and the metric volume is a duck-typed object vulnerable to Mol* interface drift.

## 5. Metrics: extensions to the catalog

The scoping section 5 catalog stands. The corpus recon adds the following, grouped by what
they need. The recurring discipline: state which map phased a support number, stratify
anything cross-entry by resolution, and never read joint behavior off marginals.

Density-support family (needs maps; per-entry client versions feasible, corpus versions
ETL):

- Per-residue RSCC plus difference-density Z (RSZD) — the standard support pair, filling
  the declared model-map slot properly. The client approximation needs the additive splat
  (a gaussian-atom calc-density) and validation against gemmi/phenix numbers before anyone
  trusts it; the honest corpus version is ETL with per-class recomputed maps (phase bias,
  section 3).
- Per-conformer support: RSCC or mean map value restricted to one altloc letter's atoms.
  Directly operationalizes "which conformers does the density actually support" and the
  ligand-in-absent-density critique. Must ship with a detectability floor: below roughly
  0.2 occupancy at 1.7 A a conformer is essentially untestable, and the number should say
  so rather than report noise.
- EDIA-style per-atom support as the first atom-level track (the Track type reserves
  atom level "later") — better behaved than RSCC at partial occupancy and a natural fit
  for painting individual split atoms.

Ensemble family (needs the ensemble reductions or files):

- ensembleRmsf as the first model-list metric: per-residue heavy-atom RMSF across frames,
  in both raw crystal-frame and superposed variants — the difference between the two
  separates rigid-body/lattice drift from internal motion, and the superposition primitive
  it requires is already on the backlog.
- Discrete-vs-continuous modality (speculative but the most scientifically interesting):
  per residue, a bimodality test on side-chain coordinates or chi1 across frames,
  cross-tabulated with qFit's split decision. Ensemble-bimodal and qFit-split is a credible
  discrete substate; ensemble-unimodal but qFit-split is a suspect overfit. This is the
  question the altloc encoding presumes an answer to, finally asked of data.

Cross-class family (the corpus's unique leverage — three differently-biased estimators of
the same crystal):

- Concordance tracks: per-residue triplet of altlocRmsf (qFit), ensembleRmsf, and B-implied
  displacement sqrt(B / 8 pi^2) from the re-refined model, plus per-entry rank correlations
  among them, resolution-stratified. Agreement is the closest available signal of true
  per-site heterogeneity amplitude; disagreement localizes method artifacts. Fence it
  honestly: concordance validates marginal amplitude only, never cross-site correlation.
- Heterogeneity-beyond-B, computable today from local files alone: altlocRmsf versus
  B-implied RMSF per residue. Large discrete spread with modest B suggests genuine
  substates rather than smear. Cheapest available "is it real" proxy before any map work.
- The R-free comparison, done carefully. The naive corpus answer is already in the tables:
  on 33,896 paired entries, ensemble refinement beats qFit about 2 to 1, but the median
  margin is only +0.006 R-free, and qFit's tail of large losses (943 entries worse by more
  than 0.05) far exceeds its tail of large wins (328). Before this number circulates it
  needs two qualifiers: whether both methods used the same free set (check the phenix logs;
  if unverifiable, the deltas are noise-inflated), and parameter counts per class (a
  200-member ensemble and a single model are not comparable by R alone). Residualize the
  delta against resolution before ranking, since ensemble size is itself
  resolution-determined.

Occupancy and correlation family (local now for the re-refined class, qFit later):

- Occupancy reliability diagnostics: corpus occupancy histograms per class (quantization
  spikes reveal the software's effective precision), occupancy-versus-B anticorrelation
  within split residues (strong compensation means the parameters are degenerate and the
  occupancy is not independently determined), and the fraction of altloc groups violating
  sum-to-one. This sets the error bar that occupancyEntropy and any future joint-state
  bookkeeping silently assume is zero.
- Clash-implied exclusivity mining, the rigorous half of the states/bundles story: across
  altloc-split models, inter-residue conformer pairs in steric clash license derived
  forbidden-state rows — geometry can prove exclusion where density cannot prove
  co-occurrence. Separately, contacting split residues with matching letters and matched
  occupancies are candidate correlated networks — candidates only, since letter coincidence
  is exactly the unenforced convention the mmcif-browser proposal criticizes. Mining 50k
  structures turns the proposal's four hand-picked examples into prevalence statistics,
  which is the empirical footing it currently lacks.
- Resolution-stratified nulls: empirical quantiles for every track metric in resolution
  bins, shipped as a small JSON, so the client can offer percentile coloring beside raw
  values. RSCC, RMSF, and conformer count are simply not comparable across resolution.

Traps to refuse (each is tempting and wrong): raw B comparisons across classes (ensemble B
is partly absorbed by pTLS and ensemble spread, qFit B is co-refined with occupancies, the
re-refined class is isotropic-only — the same symbol means three things); occupancy
entropy read as thermodynamic population entropy (occupancies are sum-constrained,
software-quantized, B-correlated — keep it descriptive); conformer count as a dynamics
proxy without per-conformer support (it counts modeling decisions); ranking absolute RSCC
across resolutions; treating ensemble RMSF as a converged posterior width (it is a
protocol output); and any inter-site correlation inferred from the average map or from
marginals (the one-body argument from grouped_occupancies_v3 — only clash logic or
external assertion licenses joint claims). modelRmsd's occupancy-weighted centroids also
deserve a flag: at split residues the centroid averages away exactly the bimodality this
project studies, so pair it with a per-letter variant before using it as a headline.

## 6. Corpus-scale plan

Ordering principle: local-first, one batched colleague request, map work cohort-scoped.

1. Manifest. One table (parquet or DuckDB) keyed by pdb_id joining all five sources with
   cohort booleans and the data-quality flags from section 1. Every filter and ranking
   below is a query against it.
2. Corpus tracks from final_model. Run the four existing altloc metrics over all 49,626
   local PDBs, emitted in the trackToJSON schema so the viewer consumes them with zero new
   code. Practical wrinkle: the files are PDB format and hetkit parses CIF in TypeScript;
   the pragmatic path is a small python reimplementation of the four formulas writing the
   same JSON, cross-checked on a hundred entries against hetkit via gemmi PDB-to-CIF
   conversion. This instantiates the Track-artifact pattern (which currently has no
   producer) at corpus scale from data that exists today.
3. Per-entry scalars derived from those tracks (altloc atom fraction, multiconformer
   residue count, max multiplicity, mean/max entropy and rmsf, proximity of split residues
   to ligands) appended to the manifest — the search index that turns "find the 5qeq-like
   hidden ensembles" or "find qFit models that collapsed to single-conformer" into
   one-liners.
4. Divergence cohort: residualized R-free delta (section 5) crossed with the scalars; name
   the top ~1-2k entries where the methods disagree most. This cohort is the shopping list
   for everything expensive.
5. The colleague request, batched once. Do not ask for 24k ensembles (median 176k atoms
   per file). Ask for: per-residue reductions computed where the ensembles live (CA and
   heavy-atom RMSF after superposition, per-residue centroids, optionally top covariance
   eigenvalues) as one small CSV per entry in the track key convention — we can send the
   spec'd script; full ensemble files only for the divergence cohort plus a ~200-entry
   showcase set; the missing structure tables for batches 5 and 6; and clarification of
   the 14,550 all-NA metric rows (reharvest or mark failed). Also ask whether the qFit
   model CIFs can be shared or fetched per-entry — the tables describe them but we hold
   two.
6. Cohort-scoped density support: for the divergence cohort only, pull sf-cif from RCSB,
   compute per-residue and per-conformer support with gemmi (per-class recomputed maps,
   dodging the phase-bias caveat), emit as tracks. Overnight-scale at 1-2k entries; the
   full 50k is a later decision.

Steps 1-4 need nothing from anyone and produce usable science (the hidden-ensemble
census, the heterogeneity-beyond-B track, the divergence cohort) before any new viewer
code. They also give the density-lab UI real tracks to project the day the generic
projection call exists.

## 7. Open questions

- Free-set provenance for the cross-class R comparison: do the phenix logs record whether
  qFit and ensemble refinement shared the re-refinement's free set? Worth a grep before
  trusting any delta.
- Is the altloc retention in final_model intentional protocol (deposited alternates kept
  through re-refinement) or an artifact worth reporting back to the colleagues? Either
  way our docs should rename the class "re-refined", not "single-conformer".
- Which entries, if any, should become the viewer's bundled demo set beyond 7A1X/9JD2? The
  5qeq-style hidden ensembles and the eventual divergence cohort are natural candidates.
- Where do corpus track artifacts live (next to the drop, object storage, in-repo
  fixtures)? The trackFromJSON path is agnostic; the manifest should record the answer.
