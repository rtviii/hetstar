# Handoff: density UI session

Written 2026-08-25, end of the session that scaffolded the app, revived the spike, and
prototyped density lab step 0. The stated focus for the next session, in the user's words:
"there's plenty of ui work that needs to go into this to make all of this usable and
combinable."

## Where things stand

The repo is a working npm workspace: Next 14 app (`hetstar-app`) + `packages/hetkit`
(molstar `^5.11.0` peer everywhere). Two routes exist. `/density-lab` is the incremental
prototyping ground (step 0: model + carved 2Fo-Fc with live sigma + Fo-Fc toggle) and
`/density-spike` is the original all-at-once spike (clip sphere, slice, metric projection),
kept until the lab reaches parity. Verified working by the user in their own browser:
structure loads with alt-loc coloring, density loads and hugs the model after the carve.
The clip-sphere fix (variant "pixel") was applied and typechecked last; if the user has not
confirmed it visually yet, that is the first thing to check.

Verification protocol: NO dev server, no browser driving. Run `npx tsc --noEmit` in `app/`
(or `npm run typecheck` at root) and hand over; the user checks visuals in their running
app at localhost:3000. `npm test` at root runs hetkit's 18 vitest tests.

## File map

- `app/src/lib/molstar/` — the viewer shell torn out of mmcif-browser main (viewer.ts,
  spec, style, tls, wiggle-falloff, labels, queries, altloc-theme) plus the two
  density modules: `density.ts` (FFT loading, isosurfaces, sigma, clip, slice, metric
  volume) and `carve.ts` (periodic-map resample around the model).
- `app/src/components/MolstarViewer.tsx` + `app/src/hooks/useMolstarViewer.ts` — React
  shell. `app/src/lib/cif-source/types.ts` came along because tls.ts needs it (redundant
  with hetkit's model/cif.ts; a seam to merge during viewer-core extraction).
- `app/src/components/lab/DensityLabPanel.tsx`, `app/src/components/spike/DensitySpikePanel.tsx`
  and their routes under `app/src/app/`.
- `packages/hetkit` — untouched this session beyond the molstar peer bump.
- `docs/dynamic-pdb-scoping.md` (founding roadmap), `docs/spike-rehoming.md` (provenance +
  corrections). Auto-memory also carries this state (dynamic-pdb-viz).

## Hard-won gotchas (do not rediscover these)

1. Mol* clip variant: "instance" tests only the mesh bounding-sphere center and
   shows/hides the whole single-instance isosurface as a unit; region clipping requires
   variant "pixel" (per-fragment discard). Sphere clip scale is the DIAMETER (shader uses
   scale * 0.5); invert: true keeps the inside.
2. FFT maps from structure factors cover exactly one unit cell, and Mol* wraps periodic
   grids only when SAMPLING values (external-volume theme) — isosurface meshes are never
   wrapped. Maps must be resampled around the model: `carve.ts`, ported from dynamic-pdb's
   expandMapAroundModel. Call it AFTER provider.parse, BEFORE building isosurfaces.
3. `carveGridAroundStructure` MUTATES `volume.grid` in place and the original cell grid is
   then GONE. Step 1 (per-residue carve) needs the pristine cell grid to resample from:
   either stash the original grid on the volume object before carving, or carve into new
   state-tree volume nodes instead of mutating. This is the first wall the next session
   hits — decide before coding.
4. Carved grids keep the SOURCE (cell-wide) stats on purpose, so sigma-relative iso levels
   retain their crystallographic meaning. Do not recompute stats on the carved box.
5. MolstarViewer's load effect keys on JSON-stringified content of view/tlsGroups/
   hetNetworks. Never revert to identity deps: viewer.clear() removes the ENTIRE state
   tree, so a re-render-triggered reload deletes density volumes out from under the panels
   (the "Could not find node" class of bug). Panels keep their view objects module-level
   anyway (VIEW constants).
6. The scaffold's tsconfig needed `"target": "ES2020"` (tsc defaults to ES5 without it and
   Map/Set iteration breaks). A stale `tsconfig.tsbuildinfo` REPLAYS old errors after
   tsconfig edits — rm it when diagnostics look impossible.
7. zsh eats `echo ===` (treats `=cmd` as expansion) — use `---` separators in shell
   one-liners.

## Agenda

Primary: the UI rework, making features usable and combinable. The spike's checkbox pile
is spike ergonomics. Sketch discussed with the user (not committed to):

- Density as one opt-in LAYER with a scope control: whole model / follow the focused
  residue. The per-residue case should be a real carve around the residue (small box,
  fast), not a clip of the global surface; clip stays for the radius-preview interaction.
- Slice as a tool with a position slider along its normal (the user explicitly wants
  movable slice planes), arbitrary normals later.
- One "color by" selector shared between structure and density (uniform / alt-loc /
  metric tracks), replacing the standalone metric-projection toggle.
- Contour and radius controls live with the layer they affect; status line stays.

Lab steps queued behind that (one at a time, user-verified before the next): step 1
per-residue carve on click (see gotcha 3), step 2 movable slice, step 3 metric projection
on the lab page. Retire `/density-spike` when the lab covers it.

Still pending from the user (asked twice, no answer yet): does `~/dev/DYNAMIC_PDB_ETL`
still hold the five files the scoping doc describes (7A1X deposited + sf + qFit, 9JD2 sf +
qFit), and should Level 1 structure loading be local-files-first or include RCSB fetch from
the start?

## Conventions

No emojis, no implication arrows or set symbols in prose. Explain crystallography plainly
(the user asked for the contours explainer). The user commits and pushes themselves; do not
push, and commits made by Claude carry no Co-Authored-By trailer per the user's preference.
Ask Deepwiki (or the local node_modules source, which worked well this session) before
guessing about Mol* internals.
