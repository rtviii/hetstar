import type { EntryDef } from "../lib/lab/entries";

// The hetcif example files (copies of ~/dev/hetcif/examples/hetcif), served by the dev app
// from app/public/hetcif/. Listed by the hetcif preset only.

export const HETCIF_GROUP = "hetcif: state variables and tables";

export const HETCIF_ENTRIES: readonly EntryDef[] = [
  {
    id: "TWO-POCKET",
    label: "Two-pocket EDO site: one variable, six joint states",
    group: HETCIF_GROUP,
    blurb: "Constructed, 40 atoms. Ligand or EDO1 in the top pocket, EDO2, EDO3 or nothing below. The six joint probabilities that occupancies alone cannot carry, as one variable whose states are the observed combinations.",
    qfit: { url: "/hetcif/constructed_two_pocket.cif", note: "constructed two-pocket example from the mmcif-browser proposal, converted by hetcif from-proposal; local file from the hetcif repo" },
  },
  {
    id: "7HHS-APO-BOUND",
    label: "7HHS apo/bound: a ligand with two poses and its loop as one variable",
    group: HETCIF_GROUP,
    blurb: "150 atoms around a ligand site. Three joint states: apo (loop A, no ligand), bound pose 1, bound pose 2. Compositional and conformational change in one record.",
    qfit: { url: "/hetcif/7HHS_apo_bound.cif", note: "7HHS ligand-site excerpt from the mmcif-browser proposal, converted by hetcif from-proposal; local file from the hetcif repo" },
  },
  {
    id: "5E1N-ARG74",
    label: "5E1N Arg74 + water: one exclusion, maximum-entropy joint",
    group: HETCIF_GROUP,
    blurb: "59 atoms. Three arginine rotamers and a partial water that cannot coexist with rotamer B. The proposal stated only the exclusion; the converter completed the joint by maximum entropy and says so (provenance assert).",
    qfit: { url: "/hetcif/5E1N_arg74_clash.cif", note: "5E1N Arg74 excerpt from the mmcif-browser proposal, converted by hetcif from-proposal; local file from the hetcif repo" },
  },
  {
    id: "5E1N-GLN8",
    label: "5E1N Gln8: backbone segment and side chain as two independent variables",
    group: HETCIF_GROUP,
    blurb: "71 atoms. Residues 6 to 8 share three backbone conformers; the Gln8 side chain has two rotamers of its own. The pattern qFit produces everywhere, in isolation.",
    qfit: { url: "/hetcif/5E1N_gln8_split.cif", note: "5E1N Gln8 excerpt from the mmcif-browser proposal, converted by hetcif from-proposal; local file from the hetcif repo" },
  },
  {
    id: "5E1N-CA-SITE",
    label: "5E1N calcium site: two loop segments, independent",
    group: HETCIF_GROUP,
    blurb: "272 atoms. An entry loop with two conformers and an exit loop with four, written as independent variables: eight worlds, no table.",
    qfit: { url: "/hetcif/5E1N_ca_site.cif", note: "5E1N calcium-site excerpt from the mmcif-browser proposal, converted by hetcif from-proposal; local file from the hetcif repo" },
  },
  {
    id: "7A1X-ARG102",
    label: "7A1X Arg102: side chain conditioned on its backbone segment (carved)",
    group: HETCIF_GROUP,
    blurb: "Real qFit conformers, 9 residues. Segment 97-102 (A, D, E) and the Arg102 side chain (A, B, C) with the steric table: segment D never meets side chain A or C. Seven legal worlds of nine.",
    qfit: { url: "/hetcif/7a1x_arg102.cif", note: "carved from the 7A1X flagship file by hetcif carve (variables A97-102, A102, residues within 5 A as base); local file from the hetcif repo" },
  },
  {
    id: "7A1X-WATER304",
    label: "7A1X water 304: a water given two backbone segments (carved)",
    group: HETCIF_GROUP,
    blurb: "Real qFit conformers, 36 residues. Segments 108-113 and 152-168 and a partial water between them, with the two-parent table: present mostly when both segments are in their majority states.",
    qfit: { url: "/hetcif/7a1x_water304.cif", note: "carved from the 7A1X flagship file by hetcif carve (variables A108-113, A152-168, A304, residues within 5 A as base); local file from the hetcif repo" },
  },
  {
    id: "7A1X-LOOP16-38",
    label: "7A1X loop 16-38: an exclusion and a nested sub-choice (carved)",
    group: HETCIF_GROUP,
    blurb: "Real qFit conformers, 44 residues. The 23-residue segment 16-38 with segment 40-41 (one forbidden combination) and Asp119 (its rare rotamer exists only under one segment state). Ten legal worlds of eighteen.",
    qfit: { url: "/hetcif/7a1x_loop16-38.cif", note: "carved from the 7A1X flagship file by hetcif carve (variables A16-38, A40-41, A119, residues within 5 A as base); local file from the hetcif repo" },
  },
  {
    // hetcif exercise entry: the 7A1X qFit model converted to hetcif plus the flagship's
    // synthetic correlation layer (~/dev/hetcif, docs/flagship.md). Served by the dev app
    // from app/public/hetcif/; the world panel appears because the file carries
    // _hetcif_* categories.
    id: "7A1X-HETCIF",
    label: "7A1X-HETCIF: the whole qFit model (382 variables, 4 tables)",
    group: HETCIF_GROUP,
    blurb: "The full flagship file: every qFit conformer of 7A1X as a state variable plus the four asserted tables. Large; the carved examples below show the same tables one at a time.",
    qfit: {
      url: "/hetcif/7a1x_flagship.cif",
      note: "7A1X qFit multiconformer model converted to hetcif (382 variables; backbone segments as one variable each) plus four asserted conditional tables from the flagship case; local file from the hetcif repo",
    },
    deposited: {
      url: "https://files.rcsb.org/download/7A1X.cif",
      note: "deposited 7A1X model, fetched from RCSB at load time",
    },
    sf: {
      url: "https://files.rcsb.org/download/7A1X-sf.cif",
      approxMB: 5.6,
      note: "deposited 7A1X structure factors with map coefficients, fetched from RCSB at load time",
    },
  },
];
