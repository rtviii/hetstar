# Sequence lanes and the structure-sequence bridge

The bottom strip of /compare-lab is a lane viewer: one chain at a time, a ruler, and one
row per enabled lane, all drawn against the chain's polymer sequence. This note records
the contract so new lanes and new consumers of the bridge build on the same footing.

## Coordinates

A lane's x-axis is the chain's positions: 1-based indices into the polymer sequence
(label_seq_id in wwPDB terms). Everything the rest of the app speaks is author-keyed:
Mol* picks, hetkit Tracks, qFit letters, the actions popup. The bridge
between the two is hetkit's SequenceModel (packages/hetkit/src/model/sequence.ts):

- `buildSequenceModel(file, table)`: per chain, `positions[]` of `{ pos, compId, letter,
  ref: ResidueRef | null, observed }`, plus `posByKey` (residueKey to pos). `file` is the
  sequence source, `table` the model on screen. The source is `_pdbx_poly_seq_scheme`
  when the file has it (the full SEQRES with the author number of every residue,
  unobserved ones included); otherwise the observed polymer residues of `_atom_site`,
  at label_seq_id when the file carries it, else 1..n. Chains the table has and the
  source does not are framed from the table.
- `positionOf(model, ref)` and `refAt(chain, pos)` are the two directions.
- `readSecondaryStructure(file, model)` gives helix and strand spans per chain, in
  positions. `unobservedSpans(chain)` gives the gaps.

qFit and Phenix outputs carry no sequence categories at all, so the compare lab frames
model A (qFit) with model B's file (the deposited mmCIF, same entry and author
numbering) whenever B is loaded, and with A's own atom_site otherwise. `observed` is
always judged against A's atom table. This is tested headless in
packages/hetkit/test/sequence.test.ts, including the cross-file case.

## The lane module contract

app/src/components/lab/lanes/types.ts:

- `LaneModule { id, label, description, defaultOn, height, unavailable(ctx), Component,
  readout?(ctx, pos) }`. `unavailable` returns null when the lane can draw, else the
  reason the drawer shows. `readout` contributes one phrase to the hover line. `height`
  is a number, or a function of the context for lanes whose height follows the data
  (the annotation lanes pack overlapping domains into sub-rows).
- `LaneContext { chain, aTable, confPlan, secondary, metrics, colorBy, annotations }` is
  everything a lane may read. `metrics` maps metric id to a computed `LaneMetric`
  (track, ramp, display domain) or to the string reason it cannot be computed yet;
  `colorBy` is the metric the host resolved from the color-by dropdown, painted by the
  sequence lane; `annotations` carries the PDBe annotations (lib/annotations/pdbe.ts) —
  `"loading"` while the fetch is in flight, null when the entry has no wwPDB id.
  `LaneView { length, width, cell }` is the geometry the host measured.
- A lane's Component receives `{ ctx, view, onSelectSpan }` and renders into the lane's
  track area (position: relative, `height` px). DOM lanes place features with
  `spanStyle(span, length)` (percent of the lane, so fitted and zoomed agree); canvas
  lanes size to `view.width`. Features that should select their range call
  `onSelectSpan` and stop pointerdown propagation so the host does not start a drag.
- Lanes never receive hover or selection. The host paints both as columns over the
  whole board, so a lane re-renders only when its data or the geometry changes.
- Registration of a structural lane is one entry in lanes/registry.ts. Metric lanes are
  generated instead: the host builds one module per metric with `makeMetricLane(id,
  label, description)` (lanes/PlotLanes.tsx) and passes them via the `metricLanes` prop,
  so the metric list stays app-level knowledge. The on/off set (structural and metric
  ids alike, metric ids prefixed `metric:`) lives in localStorage under
  `hetstar.lanes.enabled`; a lane that is on but unavailable is simply not drawn and
  returns when its data appears (a map metric before the density loads).

Lanes today: sequence (letters, dots or a dense tile by room per residue, optionally
tinted by the color-by metric), conformers (model A altloc count, canvas), one lane per
metric (its track in its ramp, canvas; the metric name is the row label), secondary
structure and unobserved (span features from the deposited file, off by default), the
ligand-contacts lane (computed from model A: heavy atom within 4 A of a ligand/ion),
and the PDBe annotation lanes (Pfam/CATH/SCOP/InterPro domain spans and
modified-residue marks, off by default).

Async annotation data is HOST-OWNED, mirroring the metrics: CompareLabPanel fetches the
PDBe mappings + modified-residue endpoints once per entry (lib/annotations/pdbe.ts,
direct fetch — PDBe sends open CORS; the old binding_sites endpoints are retired, hence
the locally computed contacts lane), converts them to lane positions through the
SequenceModel (label chains join via `authOfLabelAsym`, author numbering via `posByKey`,
label_seq directly when `positionsAreLabelSeq`), and passes the result down as the
`annotations` prop. A lane module never fetches for itself; that is what lets
`unavailable(ctx)` tell the drawer "fetching from PDBe..." or "PDBe lists no Pfam for
this entry".

The chain header between the toolbar and the board states what the chain IS:
`ChainSequence.entityDescription` (the `_entity.pdbx_description` joined by
`buildSequenceModel`; null for qFit/Phenix output) plus modeled/unmodeled counts,
altloc fraction and mean B computed from the atom table.

## Selection and hover flow

Host (lanes/SequenceLanes.tsx) to structure: a click on an observed residue emits
`onSelect({ chain, from: seq, to: seq })`; a drag or a feature click emits the range of
author numbers under the span. The host listens with pointer events and captures the
pointer on down, so a drag survives leaving the strip; while a drag is live no hover is
emitted (no Mol* highlight churn), the drag state only updates when the end crosses a
residue boundary, and the track rect is measured once and cached (invalidated on
scroll/resize/zoom) instead of per move. CompareLabPanel turns a single residue into the
pick (3D select marker, actions-popup target, centroid) and a range into the range
selection.
A right click emits `onContext(target, anchor)` — the whole selection when it lands
inside a multi-residue selection, else the residue under the cursor — and the panel
opens the same actions popup a 3D right click does. Hover emits `onHover(ref)` for
observed residues and the panel highlights the residue in Mol*.

Structure to host: the panel passes `selection` (the range, or the pick as a one-residue
range) and `hoverRef` (the 3D hover). The host places both with `positionOf`, and
switches the active chain to the selection's chain when it differs. Nothing in the lanes
imports Mol*.
