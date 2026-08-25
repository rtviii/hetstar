# hetstar

Dynamic PDB heterogeneity viewer. Standalone re-home of the `@dynamic-pdb/hetkit` package and
the density capability spike originally built on a branch of mmcif-browser (deleted 2026-08-21;
see `docs/spike-rehoming.md` for provenance and the full re-homing plan).

## Layout

- `docs/dynamic-pdb-scoping.md` — the founding scoping doc: qFit-at-scale dataset profile,
  Mol* density capability assessment, metrics catalog, architecture.
- `docs/spike-rehoming.md` — what the spike proved, the config that has to be reconstructed,
  the spike panel's unsatisfied imports, and the improvement backlog.
- `packages/hetkit/` — heterogeneity model + metrics + Mol* viewer bridges. Raw-TS subpath
  exports (`/model`, `/metrics`, `/viewer`), molstar as peer, vitest tests with real qFit
  fixtures. Works today: `cd packages/hetkit && npm install && npm test`.
- `reference/spike/` — the density spike (client-side FFT from sf-cif, isosurfaces, clip
  sphere, plane slice, metric-colored density). Does not compile standalone; it awaits the
  app scaffold and a viewer shell (imports listed in the rehoming doc).

## State

Pre-scaffold. No app yet. Next step: create the Next.js app (workspace layout and the exact
`transpilePackages` / molstar `^5.11.0` settings are in `docs/spike-rehoming.md`), then wire
the spike back in.
