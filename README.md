# hetstar

A heterogeneity viewer for Dynamic PDB entries, packaged as one React component
(`<HetstarViewer entryId=... />`) so it can be dropped into the dynamicpdb.com website. It is a
prototype under active iteration. This README is also the handoff for the dynamic-pdb side:
what the viewer is, where its boundary is, how it talks to the Dynamic PDB API, and what we
would need from that API.

## What it shows

- Two models of one entry in one scene. Model A is the qFit multiconformer model, collapsed
  to its highest-occupancy conformer by default and expandable per residue. Model B is the
  deposited model, drawn as a toggleable ghost. A multi-model ensemble (so far the NMR
  examples fetched from RCSB) loads as model A with a frame scrubber and per-residue RMSF.
- Experimental density computed in the browser. The deposited structure factors (sf-cif) are
  FFT'd by Mol* into 2Fo-Fc and Fo-Fc maps, then carved around the model. Sigma, opacity, clip
  and slice controls are available. Density loads in the background and is off until toggled.
- Per-residue metrics from `@dynamic-pdb/hetkit`, painted onto the density surface: conformer
  count, occupancy entropy, mean B-iso, bond variability, ensemble RMSF, model A vs B RMSD,
  altloc RMSF delta, and Fo-Fc mean, peak and support delta.
- A sequence lane viewer under the canvas: one chain at a time, secondary structure, PDBe
  domain and modification annotations, ligand contacts, and metric plots, all linked to the 3D
  selection.
- Selection tools: multi-range and atom-level selection, representation actions, conformer
  distances (Mol* measurements), hydrogen bond and contact dashes, and numbered selection
  bookmarks.

## Running it

```bash
npm install
npm run dev        # compiles the viewer CSS, watches it, and serves the app at localhost:3000 (opens 7APT)
npm test           # hetkit test suite (real qFit fixtures)
npm run typecheck  # app + both packages
```

Layout:

- `packages/hetkit` (`@dynamic-pdb/hetkit`) contains the heterogeneity model (altloc groups,
  ensembles, sequence mapping) and the metrics. It is pure TypeScript with no UI, and molstar
  is a peer dependency for CIF parsing.
- `packages/hetstar` (`@dynamic-pdb/hetstar`) is the viewer: React components, Mol*
  plumbing, the Dynamic PDB catalogue client, and a precompiled stylesheet.
- `app` is a thin Next.js 14 shell. It has one page that renders the viewer full-screen, and
  two route handlers that proxy the Dynamic PDB API and file host in development.

## The package boundary

```ts
import { HetstarViewer } from "@dynamic-pdb/hetstar";
import "@dynamic-pdb/hetstar/styles.css";

<HetstarViewer
  entryId="dpdb_kytgultv"                               // reloads whenever it changes
  dpdb={{ apiBase: "/api/v1", fileProxy: "" }}          // optional, see below
  className="..."                                       // optional; the viewer fills its box
/>
```

- `entryId` is the entry the viewer shows: a `dpdb_...` id, or one of the PDB ids in the small
  alias map (`lib/dpdb/resolve.ts`). The entry chip in the sidebar still lets a user load a
  different entry inside the viewer, but whenever the host changes `entryId` the viewer
  follows it.
- `dpdb.apiBase` is the JSON:API base (default `/api/dpdb`, the dev proxy).
- `dpdb.fileProxy` is a route that takes `?u=<artifact uri>` and returns the file (default
  `/api/dpdb-file`). An empty string fetches artifact URIs directly.
- It is client-only. Mol* needs `window` and WebGL, so render it through
  `next/dynamic(..., { ssr: false })`.
- It ships raw TypeScript (like hetkit), so a Next host needs both packages in
  `transpilePackages`.
- Peer dependencies are `molstar ^5.11`, `react ^18` and `react-dom ^18`.
- The stylesheet is compiled from Tailwind at build time (`npm run css` in the package), so
  the host needs no Tailwind.
  - Every utility is scoped under the `.hetstar` wrapper the component renders.
  - Tailwind's global preflight is off. A copy of it is scoped to the wrapper with
    zero-specificity `:where()` selectors.
  - The only global rules left are Tailwind's `--tw-*` custom-property defaults on `*`.
- The Mol* stylesheet is not imported by the package. The host provides it:
  `molstar/build/viewer/molstar.css`, or the Mol* Sass skin the website already loads.
- Fonts come from `--font-plex-sans` and `--font-plex-mono` when the host defines them, and
  fall back to system fonts otherwise.
- It writes two localStorage keys: `hetstar.lab.bookmarks.<entryId>` (selection bookmarks)
  and `hetstar.lanes.enabled` (which lanes are shown).
- Besides the Dynamic PDB API and file host, the browser fetches from `files.rcsb.org`
  (deposited sf-cif, and the few RCSB example ensembles) and `www.ebi.ac.uk/pdbe/api`
  (`/mappings/{pdb}` and `/pdb/entry/modified_AA_or_NA/{pdb}` for the lanes). Both send open
  CORS headers.

## How the viewer uses the Dynamic PDB API

This was written against the public API as it behaved on 2026-09-10 (JSON:API at
`https://dynamicpdb.com/api/v1`). All of it lives in `packages/hetstar/src/lib/dpdb/`.

One entry load makes these calls (`client.ts`, `fetchEntryManifest`):

1. `GET entries/{id}` for the title, resolution, PDB reference, space group, crystallization
   facts, and polymer entities (description, organism, UniProt). The sidebar entry card shows
   these.
2. `GET entries/{id}/models` (in parallel with 1) for every model's title, metadata and
   metrics (R-work, R-free, and clashscore and Ramachandran outliers where present).
3. `GET entries/{id}/models/{model}/artifacts` for each deposited, qFit and ensemble model,
   so 1 to 3 requests. Re-refined models are listed but not fetched yet.

That is three to five API requests per entry, against the backend rate limit of 100 requests
per 10 s per IP.

How the responses are interpreted:

- A model's role is derived from its title ("Deposited model", "qFit model", "Rerefined
  model", "Ensemble refinement model"). `metadata.model_type` is only a fallback, because it
  was inconsistent across entries, and the `_m_NNN` suffix is not stable.
- The coordinate file is the artifact with `type: "model"` whose id matches the model's
  `primary_artifact_id`, falling back to the first model artifact. The viewer uses its `uri`,
  `format`, `size_bytes` and `sha256`. The qFit artifact list's `meta.runs` supplies the
  software line shown in provenance.
- Structure factors come from the first `structure_factors` artifact listed. If there is
  none, the viewer uses `https://files.rcsb.org/download/{PDB}-sf.cif`. Above 50 MB the viewer
  asks before downloading, because PanDDA deposits reach hundreds of MB.
- Pairing (`types.ts`, `pickPair`): model A is qFit if present, else the ensemble, else the
  deposited model. Model B is the deposited model when A is not. Only CIF-format models load
  for now; hetkit's atom table is CIF-only.
- Coordinates and sf-cif are downloaded by the browser as text and handed to Mol*.
  `toFetchableUrl` routes URIs on `files.dynamicpdb.com` and `dynamicpdb.com` through
  `fileProxy`. RCSB URIs are fetched directly.

Why the dev proxy exists:

- The API only allows the `https://dynamicpdb.com` origin (plus localhost:3000 in a local
  backend).
- `files.dynamicpdb.com` (S3 via CloudFront) sends no CORS headers at all.
- So `app/src/app/api/dpdb/[...path]/route.ts` forwards to `https://dynamicpdb.com/api/v1`,
  and `app/src/app/api/dpdb-file/route.ts` fetches an allow-listed `https` URI server-side,
  follows redirects, and streams the body back.
- Both use `app/src/lib/dpdb-proxy.ts`. They are development scaffolding and are not part of
  the package.

## Dropping it into dynamic-pdb/website

No integration work has been done on the website side yet. This is the shortest path we see:

1. Make both packages visible inside the website's Docker context:
   - copy `packages/hetkit` and `packages/hetstar` to, for example, `website/packages/`;
   - add `"@dynamic-pdb/hetkit": "file:packages/hetkit"` and
     `"@dynamic-pdb/hetstar": "file:packages/hetstar"` to `website/package.json`.
   - (Copying their `src/` trees under `website/src/` also works. The packages use only
     relative imports, so they do not collide with the website's `@/` alias.)
2. In `website/next.config.ts`, add
   `transpilePackages: ["@dynamic-pdb/hetkit", "@dynamic-pdb/hetstar"]`.
3. Import `@dynamic-pdb/hetstar/styles.css` once, e.g. in `website/src/app/layout.tsx` next
   to the existing Mol* skin import.
4. Render the viewer for the entry currently open on the site, e.g. on the Structure tab of
   `website/src/app/entries/[entryId]/scope-page.tsx` in place of (or next to)
   `StructurePanel`:

   ```tsx
   const HetstarViewer = dynamic(
     () => import("@dynamic-pdb/hetstar").then((m) => m.HetstarViewer),
     { ssr: false },
   );

   <div style={{ height: "80vh" }}>
     <HetstarViewer entryId={entryId} dpdb={{ apiBase: "/api/v1", fileProxy: FILE_PROXY }} />
   </div>
   ```

   On dynamicpdb.com the API is same-origin under `/api`, so `apiBase: "/api/v1"` needs no
   CORS. For artifacts on `files.dynamicpdb.com` there are two options:
   - add a CloudFront CORS rule for `https://dynamicpdb.com` and pass `fileProxy: ""`, or
   - keep a small proxy route by copying `app/src/app/api/dpdb-file/route.ts` and
     `app/src/lib/dpdb-proxy.ts`. Next 16 route params are a Promise, but this route reads
     only the query string, so it ports unchanged.
5. The website runs Next 16 with webpack and React 18.3, and already depends on molstar 5.11.
   The viewer was developed on Next 14. We expect no issues, but the pairing is untested.

## Asks for the Dynamic PDB API

The first two items are what actually block the embedded case. The rest would remove
guesswork from the client.

- CORS on `files.dynamicpdb.com` for `https://dynamicpdb.com`, and for our dev origins if you
  are willing. This matters even when embedded: the file host is a different origin from the
  site.
- PDB id resolution the viewer can rely on. The local backend checkout already has
  `GET /v1/entries?pdb_id=...`, and uncommitted work addressing entries and models by PDB id
  and model slug. Once those are live, `lib/dpdb/resolve.ts` can drop its hand-maintained
  alias map (7APT, 5GQJ, 5R8T).
- An explicit model `role` (deposited / qfit / rerefined / ensemble) instead of inferring it
  from the title.
- A files shortcut for PDB-format models (re-refined `_020.pdb`, ensemble PDBs). Today
  `/v1/files/{entry}/{model}/{filename}` covers only `<entry>.cif` and `<entry>-sf.cif`.
- `size_bytes` filled on every sf-cif artifact (it is sometimes null), so the download gate
  can warn before fetching large files.
- `meta.total` on list endpoints, and a sparse fields mode for bulk listing.
- Headroom on the rate limit for the viewer's bursts: one load is up to 5 API calls plus the
  file downloads.
