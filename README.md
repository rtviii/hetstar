# hetstar

A heterogeneity viewer for Dynamic PDB entries, packaged as one React component
(`<HetstarViewer entryId=... />`) so it can be dropped into the dynamicpdb.com website. It is a
prototype under active iteration. This README is also the handoff for the dynamic-pdb side:
what the viewer is, where its boundary is, how it talks to the Dynamic PDB API, and what we
would need from that API.

## What it shows

- The models of one entry in one scene. One of them is the main view's model (the qFit
  multiconformer model by default): picks, the sequence lanes and the conformer tools act on
  it, and it is collapsed to its highest-occupancy conformer by default and expandable per
  residue. The others stand behind it as translucent ghosts, each shown or hidden on its own;
  the deposited model is shown on load. Any model becomes the main view from its card in the
  Models Switchboard, in place: the maps, the camera, the selection and the clip sphere stay,
  and a model that returns as the main view gets back the member and the expanded conformers
  it was left on. A multi-model ensemble loads with a member stepper on its card and
  per-residue RMSF.
- The Models Switchboard: a panel at the right edge of the viewer, resizable by its left edge,
  with one card per model of the entry stacked in it. A card says what the model is (kind,
  software, R-work and R-free, altlocs or members, distance from the main model as filed) and
  carries switches for main view, drawn in the main view, its replica (the model alone in a
  small canvas turned like the main view), its style, and reference. The facts and switches
  are the card's left half and the replica its right half, so that more models fit in the
  panel's height. The main view's model is the card ruled in the accent colour.
- Experimental density computed in the browser. The deposited structure factors (sf-cif) are
  FFT'd by Mol* into 2Fo-Fc and Fo-Fc maps, then carved around the model. Sigma, opacity and
  clip controls are available. Density loads in the background and is off until toggled.
- Per-residue metrics from `@dynamic-pdb/hetkit`: conformer count, occupancy entropy, mean
  B-iso, bond variability, ensemble RMSF, model A vs B RMSD, altloc RMSF delta, and Fo-Fc
  mean, peak and support delta. Two are computed only when asked for, against the 2Fo-Fc map:
  RSCC and Q-score (MapQ's definition, with symmetry copies as neighbours and an altloc rule
  of its own; within 0.01 per residue of ChimeraX's QScore on the two entries it was checked on).
- One style board for every choice of look. A model has one look, the same in the main view
  and in its replica. The board has two tabs: Colour (the sources of colour grouped by
  concept: looks, motion, heterogeneity, comparisons, fit to the map, stored values, loci) and
  Representation (cartoon, cartoon with side chains, sticks, atoms; ligands and ions on or
  off). Its columns are the things that have a look: each model that is drawn somewhere, and
  the 2Fo-Fc map. A cell switches one target, the "all" column every target that can show the
  row, and the eye under a column's name shows or hides that target. A metric is coloured on
  one range in every 3D view showing it; the range is printed at the end of its row. The same
  board opens on one model alone from the style button of its card, and on the sequence lane
  alone from the colour button of the lanes strip: the rows are one catalogue, so the three
  never differ in what they offer. Escape closes a board.
- A sequence lane viewer under the canvas: one chain at a time, secondary structure, PDBe
  domain and modification annotations, ligand contacts, and metric plots, all linked to the 3D
  selection.
- Selection tools: multi-range and atom-level selection, representation actions, conformer
  distances (Mol* measurements), hydrogen bond and contact dashes, and loci: selections set
  apart as components of their own, each with a row in the loci stack, a visibility switch, its
  mask drawn in 3D and an RSCC per loaded model.

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
- `preset` carries a consumer's opinions and nothing else: the representation the viewer
  opens with, the colour modes the style board offers, the Mol* colour themes to register, and
  the example entries the entry chip lists (`packages/hetstar/src/presets/`). Omitted, the
  viewer uses `dynamicpdbPreset`, the structure-card look (ghost cartoon, purple ramp by
  conformer count, ligand hues), so the website passes nothing. `hetcifPreset` is
  ball-and-stick with letter colours and the hetcif example files. Everything the viewer does
  because of what a file carries (altlocs, model numbers, hetcif state variables) is the same
  under every preset; a preset must not be the place where engine behaviour changes. One
  example: under a cartoon, the polymer residues hetcif variables cover are drawn as thin
  sticks over the trace, so a world choice moves atoms under the card look too.
- `modelId` is the model the main view opens on; omitted, the viewer picks (qFit, else the
  ensemble, else the deposited model). Changing it while `entryId` stays the same switches the
  main view in place, as the card's own switch does.
- `switchboard` controls the Models Switchboard, the panel of model cards at the right edge
  of the viewer (`packages/hetstar/src/components/switchboard/`). It is on by default; `false`
  removes it, and `{ defaultOpen, boxes, maxBoxes }` sets whether it starts open, whether an
  entry opens with a replica for every model whose file is small (the default, `boxes: "all"`)
  or for the main view's model alone (`boxes: "primary"`), and how many replicas it allows (4
  by default, 6 at most: every replica is a WebGL context of its own). A model file above 5 MB
  is fetched only when its model is asked for. The dev app's `/switchboard` page opens a real
  deposition (`?entry=dpdb_...`, `?model=<model id>`, `?boxes=primary`). A replica shows one
  whole model of the entry turned like the main view, mirrors the main view's selection,
  hover and selection representations, and draws a translucent sphere where the main view is
  (its clip sphere, or what its camera frames once zoomed in). Rotating any view rotates all
  of them; clicking a residue in a replica sends the main view there. Hosts that need
  to find the panel or the top-right tray in the DOM can use `[data-hetstar-part="switchboard"]`
  and `[data-hetstar-part="tray"]`. To time a switch of the main view, set
  `localStorage["hetstar.timing"] = "1"` (or add `?hetstar-timing` to the URL): each switch
  prints one table of its steps to the console.
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
- It writes two localStorage keys: `hetstar.lab.loci.<entryId>` (the entry's loci; an older
  `hetstar.lab.bookmarks.<entryId>` is read once as loci) and `hetstar.lanes.enabled` (which
  lanes are shown).
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
3. `GET entries/{id}/models/{model}/artifacts` for every model, so 1 to 4 requests. Any of them
   can be the model the host asks for.

That is three to six API requests per entry, against the backend rate limit of 100 requests
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
- The main view's model (`types.ts`, `pickMainModel`) is the one the host passed as
  `modelId`, else qFit if present, else the ensemble, else the deposited model. The deposited
  model is fetched with it: it is the ghost an entry opens with, and its file frames the
  sequence lanes. The other models are fetched ahead when their files are small.
- No model is superposed on another. Models refined against the same data share a frame; each
  card shows the mean trace-atom distance of its model from the main one as filed, and marks
  a model that is more than 1 A off.
- PDB-format models (re-refined `_020.pdb`, ensemble PDBs) are converted to mmCIF text in the
  browser on arrival (`pdbToCifText` in hetkit, through Mol*'s own PDB converter). Everything
  after the download reads CIF, so once the catalogue serves mmCIF this step is simply skipped.
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
- mmCIF for the PDB-format models (re-refined `_020.pdb`, ensemble PDBs), issue #97. The viewer
  converts them in the browser for now, but `/v1/files/{entry}/{model}/{filename}` covers only
  `<entry>.cif` and `<entry>-sf.cif`, so those models have no download shortcut.
- `size_bytes` filled on every sf-cif artifact (it is sometimes null), so the download gate
  can warn before fetching large files.
- `meta.total` on list endpoints, and a sparse fields mode for bulk listing.
- Headroom on the rate limit for the viewer's bursts: one load is up to 5 API calls plus the
  file downloads.
