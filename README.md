# hetstar

Dynamic PDB heterogeneity viewer. Standalone re-home of the `@dynamic-pdb/hetkit` package and
the density capability spike originally built on a branch of mmcif-browser (deleted 2026-08-21;
see `docs/spike-rehoming.md` for provenance).

## Layout

- `app/` — the Next.js app (workspace member `hetstar-app`). `/density-spike` is the revived
  spike route; the Mol* viewer shell under `src/lib/molstar/` and `src/components/` was torn
  out of mmcif-browser main and is queued for extraction into `hetkit/viewer`.
- `packages/hetkit/` — heterogeneity model + metrics + Mol* viewer bridges. Raw-TS subpath
  exports (`/model`, `/metrics`, `/viewer`), molstar `^5.11.0` as peer, vitest tests with
  real qFit fixtures.
- `docs/dynamic-pdb-scoping.md` — the founding scoping doc: qFit-at-scale dataset profile,
  Mol* density capability assessment, metrics catalog, architecture.
- `docs/spike-rehoming.md` — what the spike proved, the reconstructed config, and the
  improvement backlog.

## Commands

From the repo root: `npm install`, then `npm run dev` (app on localhost:3000),
`npm test` (hetkit suite), `npm run typecheck` (app + package).
