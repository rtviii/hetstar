# Re-homing the hetkit density spike: gist and proposed improvements

Written 2026-08-21, the day the source branch was deleted.

Provenance: everything in this repo was salvaged from the `hetkit-density-spike` branch of
github.com/rtviii/mmcif-browser, a single commit `7c556ca28c69ce9d055b1752a93d1904348ce6f5`
("Workspace + @dynamic-pdb/hetkit package + density spike + scoping doc"). The content was
approved but the decision was to build the dynamic PDB heterogeneity viewer as a standalone
project (this one, hetstar) rather than ride inside mmcif-browser, so that branch was deleted
locally and on GitHub without ever being merged or PR'd. mmcif-browser's `main` was never
touched. This document records what died with the branch that is not visible in the salvaged
files themselves: the workspace mechanics, the app-side config edits, the unsatisfied
dependencies of the spike panel, and the improvement backlog.

## What was salvaged, and where it sits here

- `docs/dynamic-pdb-scoping.md` — the founding document, copied verbatim. Dataset profile of
  the qFit-at-scale corpus, the Mol* capability assessment (the four density questions,
  answered), the metrics catalog, and the architecture. Its internal path references
  (`app/src/...`, "this repo") refer to the old mmcif-browser layout; translate via this file.
- `packages/hetkit/` — the `@dynamic-pdb/hetkit` package, verbatim. Three raw-TypeScript
  subpath exports (`./model`, `./metrics`, `./viewer`), molstar as a peer dependency, vitest
  tests (synthetic known-answer + invariants on the real qFit ETL fixtures), three CIF
  fixtures (7A1X deposited, 7a1x_qFit_010, 9jd2_qFit_010).
- `reference/spike/` — the density spike, pulled out of the old app. `density.ts` is the Mol*
  plumbing (the hard-won part), `DensitySpikePanel.tsx` the React panel that drove it,
  `density-spike-page.tsx` the trivial route wrapper. These do not compile here yet; their
  missing imports are listed below.

Not salvaged, on purpose: `app/public/spike/7a1x_qFit_010.cif` is byte-identical to
`packages/hetkit/test/fixtures/7a1x_qFit_010.cif` — when the app exists, copy the fixture
into `public/spike/`. The structure factors were never bundled at all; the spike fetches
`https://files.rcsb.org/download/7A1X-sf.cif` (5.6 MB) live.

Related but living elsewhere: `grouped_occupancies_v3.md` (the states/bundles mmCIF extension
proposal) stays in mmcif-browser; `hetkit/model`'s `parseHeterogeneity` parses the categories
it defines. The raw ETL samples are at `/Users/rtviii/dev/DYNAMIC_PDB_ETL/`.

## The gist: what the spike proved

All four density capabilities work on stock Mol* 5.11 with zero forking — composition of
existing primitives only (details and caveats in scoping section 4):

1. Serverless density from structure factors. The `sfcif` data format provider (new in
   molstar 5.11.0, 2026-07-18) FFTs `pdbx_FWT/PHWT` and `pdbx_DELFWT/DELPHWT` map
   coefficients to 2Fo-Fc and Fo-Fc grids client-side. Our `-sf.cif` files carry exactly
   those columns. No VolumeServer, no preprocessing. (Correction, 2026-08-25: the claim
   that periodic wrapping makes the map follow the model was wrong. Mol* wraps periodic
   grids only when sampling values, e.g. in the external-volume theme; the isosurface mesh
   covers just the literal one-cell grid, which renders as a box away from the model. The
   maps must be resampled around the model -- dynamic-pdb's expandMapAroundModel, ported
   here as app/src/lib/molstar/carve.ts.)
2. Live isosurface control. Sigma changes and clip objects are parameter updates on the
   representation node. Clip-sphere gotcha captured in `density.ts`: clip shapes are unit
   objects where `scale` is treated as the diameter (`sphereSD` uses `scale * 0.5`), and
   `invert: true` keeps the inside.
3. Arbitrary plane slice. The `slice` volume representation, `mode: "plane"` with point +
   normal, colored by `volume-value`. Grid and frame modes exist too.
4. Metric projected onto density. A per-atom metric splatted onto a cartesian grid becomes an
   in-memory `Volume` via a small custom state transform (`hetkit-metric-volume`, following
   the alpha-orbitals extension pattern), and the `external-volume` color theme paints any
   representation by trilinearly sampling that volume per vertex. The spike colored the
   2Fo-Fc isosurface by hetkit's conformer-count track. Critical negative finding:
   `assign-color-volume` is vestigial in 5.11 (nothing in the render pipeline reads
   `colorVolume`); `external-volume` is the live mechanism.

And one packaging proof: a private package shipping raw TS through its `exports` map,
consumed by Next via `transpilePackages`, with molstar as peer — no build step, one source of
truth, vitest as the only runner that transforms molstar's ESM-in-CJS `lib/` tree without
ceremony.

## Mechanics that died with the branch (reconstruct when scaffolding)

The old repo's workspace root `package.json` was:

```json
{
  "name": "mmcif-browser-workspace",
  "private": true,
  "workspaces": ["app", "packages/*"],
  "scripts": {
    "dev": "npm run dev -w mmcif-browser",
    "build": "npm run build -w mmcif-browser",
    "typecheck": "npm run typecheck -ws --if-present",
    "test": "npm run test -w @dynamic-pdb/hetkit"
  }
}
```

App-side edits that made the spike run (apply equivalents to the new app):

- `next.config.mjs`: `transpilePackages: ["molstar", "@dynamic-pdb/hetkit"]`.
- `package.json`: dependency `"@dynamic-pdb/hetkit": "*"`, molstar bumped `^5.10.1` to
  `^5.11.0` (the hard floor for the `sfcif` provider), and a `"typecheck": "tsc --noEmit"`
  script.

Note: `packages/hetkit/package.json` still declares `peerDependencies.molstar: "^5.10.1"` —
correct for the package itself (its viewer bridge needs nothing newer), but hetstar should
standardize on `^5.11.0` workspace-wide since the density layer requires it.

## What the spike panel still needs (unsatisfied imports)

`DensitySpikePanel.tsx` imported four things from the old app that stayed behind on
mmcif-browser `main`. The scoping doc (section 3) already classified them as
structure-agnostic and reusable; crib them from mmcif-browser when building the viewer shell
here:

- `@/components/MolstarViewer` — the React mount shell.
- `@/lib/molstar/viewer` — plugin lifecycle, load, `subscribeToClick`, and the `PickInfo`
  shape the panel relies on (`position3d`, `compId`, `chainId`, `authSeqId`).
- The `alt-loc` color theme (`app/src/lib/molstar/altloc-theme.ts`) used as the initial view;
  its palette is hardcoded A-E and wants generalizing anyway.
- Tailwind, for the panel's classes.

Longer term the plan (scoping section 6, end-state) is for `hetkit/viewer` to absorb that
generic core (viewer.ts core, queries.ts, labels.ts, themes) with TLS/heterogeneity/wiggle as
extension modules — at which point the spike panel's imports all resolve inside the package.

## Proposed improvements

Carried out of the spike, the scoping doc's backlog, and code-level observations. Roughly
ordered by how soon they bite.

Viewer and rendering:

- Extract the viewer core into `hetkit/viewer` (the item above). This is the main deferred
  architectural piece; it was postponed until the package API stabilizes against real usage.
- `external-volume` samples per vertex on the CPU (GPU sampling is an upstream TODO), so
  re-coloring a large isosurface has visible cost. Fine at spike scale; measure before
  shipping on big maps, and cache the metric volume per model (the spike memoizes it in a
  ref, which is the right instinct).
- The metric splat is a gaussian-weighted average on a 1 A grid over heavy atoms.
  Improvements: occupancy-weighted splatting, per-altloc-letter fields (which conformer does
  this density belong to), resolution-adaptive spacing.
- The slice UI only exposes axis-aligned normals; the representation supports arbitrary
  point + normal (and a `frame` mode with rotation and fractional offset). Expose when there
  is a UI story for orienting a plane.
- Density UX defaults, per the overwhelm question: density off by default, opt-in layers,
  clip-to-focus. Whether metric-colored density reads better than metric-colored atoms is an
  empirical question to test on users.

Data and metrics:

- RSCC / RSR / local density fit: the `model-map` input kind exists in `MetricDescriptor`,
  the compute does not. Honest versions belong in the ETL (gemmi/phenix conventions); a
  browser approximation is feasible for interactive what-if but must be validated against
  ETL numbers first. Per-conformer density support (RSCC restricted to one letter's atoms)
  answers "which conformers does the density actually support" and is the same machinery.
- The Track artifact path (`trackToJSON` / `trackFromJSON`) has no producer yet; the ETL
  precompute scripts are unwritten. When both an ETL and a client version of a metric exist,
  the ETL one is canonical and the client one labeled approximate.
- Strip the unmerged `_diffrn_refln` loop from sf files on ingest — 9JD2-sf is 22 MB of
  which about 90 percent is that loop, which the browser never needs.
- Ensemble RMSF (`model-list`) needs a superposition primitive first; lDDT and
  distance-difference matrices are the superposition-free comparison path.
- TLS/aniso/ensemble code paths have no exercise data in the corpus sample; acquire samples
  before hardening them.

Product surfaces:

- The 1D sequence strip framework (metric tracks, annotation layers, zoom-to-range,
  coordinated coloring via `trackColorTheme`) is the largest unbuilt UI piece; Mol*'s
  built-in sequence panel is only a placeholder.
- n-way conformer UI: the corpus is n-way (up to 5 heavy-atom letters, 3-way most common),
  per-atom scope, continuous occupancies. An A/B toggle is inadequate. Heavy-atom
  multiplicity is the definition to display (hydrogen-only letters exist, e.g. 7A1X A/102
  ARG letters D and E).
- Long term, corpus-hosted maps stream via VolumeServer (`selection-box` mode re-queries a
  box around the focus); the serverless FFT path stays as the zero-infrastructure default.
- The dynamic-pdb website integration sketch (mount point on the model page, tracks as JSON
  artifacts in object storage, promoted scalar aggregates for sortable comparison columns,
  `SortableModelList` as the comparison surface) is in scoping section 7.
