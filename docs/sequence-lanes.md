# Sequence lanes and the structure-sequence bridge

The bottom strip of /compare-lab is a lane viewer: one chain at a time, a ruler, and one
row per enabled lane, all drawn against the chain's polymer sequence. This note records
the contract so new lanes and new consumers of the bridge build on the same footing.

## Coordinates

A lane's x-axis is the chain's positions: 1-based indices into the polymer sequence
(label_seq_id in wwPDB terms). Everything the rest of the app speaks is author-keyed:
Mol* picks, hetkit Tracks, qFit letters, the metric scope, the actions popup. The bridge
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
  reason the drawer shows. `readout` contributes one phrase to the hover line.
- `LaneContext { chain, aTable, confPlan, secondary, metric }` is everything a lane may
  read. `LaneView { length, width, cell }` is the geometry the host measured.
- A lane's Component receives `{ ctx, view, onSelectSpan }` and renders into the lane's
  track area (position: relative, `height` px). DOM lanes place features with
  `spanStyle(span, length)` (percent of the lane, so fitted and zoomed agree); canvas
  lanes size to `view.width`. Features that should select their range call
  `onSelectSpan` and stop mousedown propagation so the host does not start a drag.
- Lanes never receive hover or selection. The host paints both as columns over the
  whole board, so a lane re-renders only when its data or the geometry changes.
- Registration is one entry in lanes/registry.ts. The on/off set lives in
  localStorage under `hetstar.lanes.enabled`; a lane that is on but unavailable is
  simply not drawn and returns when its data appears (the metric lane).

Lanes today: sequence (letters, dots or a dense tile by room per residue), conformers
(model A altloc count, canvas), metric (the projected track in its ramp, canvas),
secondary structure and unobserved (span features from the deposited file, off by
default). A domains lane from an annotation service is a module that fetches in its
Component, maps the service's numbering through `posByKey`, and draws spans.

## Selection and hover flow

Host (lanes/SequenceLanes.tsx) to structure: a click on an observed residue emits
`onSelect({ chain, from: seq, to: seq })`; a drag or a feature click emits the range of
author numbers under the span. CompareLabPanel turns a single residue into the pick
(3D select marker, actions-popup target, centroid) and a range into the range selection
plus the metric scope, exactly as the barplot did. Hover emits `onHover(ref)` for
observed residues and the panel highlights the residue in Mol*.

Structure to host: the panel passes `selection` (the range, or the pick as a one-residue
range) and `hoverRef` (the 3D hover). The host places both with `positionOf`, and
switches the active chain to the selection's chain when it differs. Nothing in the lanes
imports Mol*.
