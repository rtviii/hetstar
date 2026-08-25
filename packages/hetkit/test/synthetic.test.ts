import { describe, expect, it } from "vitest";

import {
  buildAtomTable,
  describeHeterogeneity,
  parseCifText,
  parseHeterogeneity,
  parseTlsGroups,
  summarizeAltlocs,
  summarizeEnsemble,
} from "../src/model";
import {
  altlocRmsf,
  bIsoMean,
  conformerCount,
  modelRmsd,
  occupancyEntropy,
  trackFromJSON,
  trackToJSON,
} from "../src/metrics";

// Hand-computable structures. Residue A/1: CA split A/B at 0.5/0.5, 1 A apart, N unsplit.
// Residue A/2: single CA. Residue A/3: backbone unsplit, CB split A/B (sidechain-only).
const ATOM_SITE_HEADER = `data_test
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.auth_seq_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.pdbx_PDB_model_num
`;

function atomRows(dx: number): string {
  const rows = [
    ["ATOM", 1, "N", "N", ".", "ALA", 1, 0 + dx, 0, 1, 1.0, 10.0, 1],
    ["ATOM", 2, "C", "CA", "A", "ALA", 1, 0 + dx, 0, 0, 0.5, 10.0, 1],
    ["ATOM", 3, "C", "CA", "B", "ALA", 1, 1 + dx, 0, 0, 0.5, 30.0, 1],
    ["ATOM", 4, "C", "CA", ".", "GLY", 2, 5 + dx, 0, 0, 1.0, 20.0, 2],
    ["ATOM", 5, "N", "N", ".", "SER", 3, 8 + dx, 0, 0, 1.0, 12.0, 3],
    ["ATOM", 6, "C", "CA", ".", "SER", 3, 9 + dx, 0, 0, 1.0, 12.0, 3],
    ["ATOM", 7, "C", "CB", "A", "SER", 3, 9 + dx, 1, 0, 0.7, 12.0, 3],
    ["ATOM", 8, "C", "CB", "B", "SER", 3, 9 + dx, -1, 0, 0.3, 12.0, 3],
  ];
  return rows
    .map(([g, id, el, atom, alt, comp, seq, x, y, z, occ, b, aseq]) =>
      [g, id, el, atom, alt, comp, "A", seq, "?", x, y, z, occ, b, aseq, comp, "A", 1].join(" "),
    )
    .join("\n");
}

const SYNTH = ATOM_SITE_HEADER + atomRows(0) + "\n";
const SYNTH_SHIFTED = ATOM_SITE_HEADER + atomRows(3) + "\n";

describe("model layer on synthetic atoms", () => {
  it("builds the atom table and residue grouping", async () => {
    const table = buildAtomTable(await parseCifText(SYNTH));
    expect(table).not.toBeNull();
    expect(table!.count).toBe(8);
    expect(table!.residues.length).toBe(3);
    expect(table!.residues[0].ref).toEqual({ chain: "A", seq: 1, ins: "" });
  });

  it("summarizes altlocs with scope classification", async () => {
    const table = buildAtomTable(await parseCifText(SYNTH))!;
    const s = summarizeAltlocs(table)!;
    expect(s.altIds).toEqual(["A", "B"]);
    expect(s.residues.length).toBe(2);
    expect(s.residues[0].scope).toBe("full"); // CA (backbone) splits
    expect(s.residues[1].scope).toBe("sidechain"); // only CB splits
    expect(s.occupancySumOk).toBe(true);
    expect(s.residues[0].occupancies).toEqual([0.5, 0.5]);
  });

  it("finds no ensemble in a single-model file", async () => {
    const file = await parseCifText(SYNTH);
    expect(summarizeEnsemble(file)).toBeNull();
  });
});

describe("metrics known answers", () => {
  it("conformer count", async () => {
    const table = buildAtomTable(await parseCifText(SYNTH))!;
    const t = conformerCount(table);
    expect(Array.from(t.values)).toEqual([2, 1, 2]);
  });

  it("occupancy entropy of a 0.5/0.5 split is exactly 1 bit", async () => {
    const table = buildAtomTable(await parseCifText(SYNTH))!;
    const t = occupancyEntropy(table);
    expect(t.values[0]).toBeCloseTo(1, 6);
    expect(t.values[1]).toBe(0);
    // 0.7/0.3 split
    expect(t.values[2]).toBeCloseTo(-(0.7 * Math.log2(0.7) + 0.3 * Math.log2(0.3)), 5);
  });

  it("altloc RMSF of two equal-weight positions 1 A apart is 0.5 A", async () => {
    const table = buildAtomTable(await parseCifText(SYNTH))!;
    const t = altlocRmsf(table);
    expect(t.values[0]).toBeCloseTo(0.5, 6);
    expect(t.values[1]).toBe(0);
  });

  it("b-iso mean is occupancy weighted", async () => {
    const table = buildAtomTable(await parseCifText(SYNTH))!;
    const t = bIsoMean(table);
    // residue 1: N (occ 1, B 10) + CA A (0.5, 10) + CA B (0.5, 30) = 30/2
    expect(t.values[0]).toBeCloseTo(15, 5);
    expect(t.values[1]).toBeCloseTo(20, 5);
  });

  it("model rmsd of a translated copy equals the translation, and of itself is 0", async () => {
    const a = buildAtomTable(await parseCifText(SYNTH))!;
    const b = buildAtomTable(await parseCifText(SYNTH_SHIFTED))!;
    const t = modelRmsd(a, b);
    for (const v of t.values) expect(v).toBeCloseTo(3, 5);
    const self = modelRmsd(a, a);
    for (const v of self.values) expect(v).toBeCloseTo(0, 8);
  });

  it("tracks survive the JSON round trip including NaN", async () => {
    const a = buildAtomTable(await parseCifText(SYNTH))!;
    const t = bIsoMean(a);
    t.values[1] = NaN;
    const back = trackFromJSON(trackToJSON(t));
    expect(back.metricId).toBe(t.metricId);
    expect(Number.isNaN(back.values[1])).toBe(true);
    expect(back.values[0]).toBeCloseTo(t.values[0], 6);
    expect(back.keys).toEqual(t.keys);
  });
});

describe("TLS parsing (synthetic; real fixtures carry no TLS)", () => {
  const TLS = `data_tls
loop_
_pdbx_refine_tls.id
_pdbx_refine_tls.origin_x
_pdbx_refine_tls.origin_y
_pdbx_refine_tls.origin_z
_pdbx_refine_tls.L[1][1]
_pdbx_refine_tls.L[2][2]
_pdbx_refine_tls.L[3][3]
_pdbx_refine_tls.L[1][2]
_pdbx_refine_tls.L[1][3]
_pdbx_refine_tls.L[2][3]
1 1.0 2.0 3.0 4.0 1.0 0.5 0.0 0.0 0.0
loop_
_pdbx_refine_tls_group.id
_pdbx_refine_tls_group.refine_tls_id
_pdbx_refine_tls_group.beg_auth_asym_id
_pdbx_refine_tls_group.beg_auth_seq_id
_pdbx_refine_tls_group.end_auth_seq_id
1 1 A 1 10
`;

  it("extracts the dominant libration axis and amplitude", async () => {
    const groups = parseTlsGroups(await parseCifText(TLS));
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.origin).toEqual([1, 2, 3]);
    expect(Math.abs(g.axis[0])).toBeCloseTo(1, 5); // L11 dominates
    expect(g.amplitudeDeg).toBeCloseTo(2, 5); // sqrt(4)
    expect(g.ranges).toEqual([{ beg: 1, end: 10 }]);
  });
});

describe("heterogeneity extension categories (synthetic; qFit files carry none)", () => {
  const HET =
    ATOM_SITE_HEADER +
    atomRows(0) +
    `
loop_
_pdbx_alt_groups.alt_group_id
_pdbx_alt_groups.auth_asym_id
_pdbx_alt_groups.auth_seq_id_start
_pdbx_alt_groups.auth_seq_id_end
_pdbx_alt_groups.label_alt_id
_pdbx_alt_groups.label_atom_id
net1 A 1 1 A .
net2 A 1 1 B .
loop_
_pdbx_heterogeneity_hierarchy.alt_group_id
_pdbx_heterogeneity_hierarchy.coexistence_group_id
net1 g1
net2 g1
`;

  it("parses networks, reads occupancies via the atom index, enumerates states", async () => {
    const file = await parseCifText(HET);
    const table = buildAtomTable(file)!;
    const het = parseHeterogeneity(file, table)!;
    expect(het.networks.map((n) => n.id).sort()).toEqual(["net1", "net2"]);
    expect(het.byId.get("net1")!.occupancy).toBeCloseTo(0.5, 6);
    expect(het.byId.get("net2")!.occupancy).toBeCloseTo(0.5, 6);
    expect(het.stateSource).toBe("independent");
    // one coexistence group summing to 1: exactly one state per member, no "none" option
    expect(het.states.length).toBe(2);
    const ps = het.states.map((s) => s.probability);
    for (const p of ps) expect(p).toBeCloseTo(0.5, 6);
  });

  it("describeHeterogeneity stitches all summaries together", async () => {
    const d = describeHeterogeneity(await parseCifText(HET));
    expect(d.table).not.toBeNull();
    expect(d.altlocs).not.toBeNull();
    expect(d.ensemble).toBeNull();
    expect(d.extensions).not.toBeNull();
    expect(d.motion.tlsGroups).toEqual([]);
    expect(d.motion.hasAniso).toBe(false);
  });
});
