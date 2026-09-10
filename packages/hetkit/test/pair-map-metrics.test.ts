import { describe, expect, it } from "vitest";

import { buildAtomTable, parseCifText } from "../src/model";
import { conformerSupport, makeTrack, mapSupportDelta, mapValueTracks, scopeTrack, trackDelta } from "../src/metrics";

// Same hand-computable synthetic as synthetic.test.ts: residue A/1 with CA split A/B at
// 0.5/0.5 one Angstrom apart in x, A/2 a lone CA, A/3 backbone unsplit with CB split
// 0.7/0.3. `dx` shifts every atom in x, giving a second model in the same frame.
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

// A sampler whose value is just the x coordinate makes every aggregate hand-computable.
const sampleX = (x: number) => x;

describe("map-sampler metrics", () => {
  it("computes occupancy-weighted mean and signed peak per residue", async () => {
    const table = buildAtomTable(await parseCifText(SYNTH))!;
    const { mean, peak } = mapValueTracks(table, sampleX, { idPrefix: "fofc" });
    expect(mean.metricId).toBe("fofc-mean");
    expect(mean.unit).toBe("sigma");
    // A/1: (1*0 + 0.5*0 + 0.5*1) / 2 = 0.25 -- occupancy weighting, not a plain mean.
    expect(mean.values[0]).toBeCloseTo(0.25, 6);
    expect(mean.values[1]).toBeCloseTo(5, 6);
    // A/3: (8 + 9 + 0.7*9 + 0.3*9) / 3 = 26/3
    expect(mean.values[2]).toBeCloseTo(26 / 3, 5);
    expect(peak.values[0]).toBeCloseTo(1, 6);
    expect(peak.values[2]).toBeCloseTo(9, 6);
    // Symmetric domain around 0 at the max-abs mean.
    expect(mean.domain[0]).toBeCloseTo(-26 / 3, 5);
    expect(mean.domain[1]).toBeCloseTo(26 / 3, 5);
  });

  it("propagates sampler NaN as metric NaN", async () => {
    const table = buildAtomTable(await parseCifText(SYNTH))!;
    const gated = (x: number) => (x > 6 ? NaN : x);
    const { mean } = mapValueTracks(table, gated);
    expect(mean.values[0]).toBeCloseTo(0.25, 6);
    expect(Number.isNaN(mean.values[2])).toBe(true);
  });

  it("groups per-conformer support by letter with a shared row", async () => {
    const table = buildAtomTable(await parseCifText(SYNTH))!;
    // Residue A/1: shared N at x=0, CA split A (x=0, occ 0.5) / B (x=1, occ 0.5).
    const rows = conformerSupport(table, table.residues[0].rows, sampleX);
    expect(rows.map((r) => r.alt)).toEqual(["", "A", "B"]);
    expect(rows[0]).toMatchObject({ atomCount: 1, occupancy: 1 });
    expect(rows[0].mean).toBeCloseTo(0, 6);
    expect(rows[1].occupancy).toBeCloseTo(0.5, 6);
    expect(rows[1].mean).toBeCloseTo(0, 6);
    expect(rows[2].mean).toBeCloseTo(1, 6);
    // Residue A/3: shared N (x=8) + CA (x=9); CB split 0.7/0.3 both at x=9.
    const r3 = conformerSupport(table, table.residues[2].rows, sampleX);
    expect(r3[0].atomCount).toBe(2);
    expect(r3[0].mean).toBeCloseTo(8.5, 6);
    expect(r3[1].occupancy).toBeCloseTo(0.7, 6);
    expect(r3[2].occupancy).toBeCloseTo(0.3, 6);
  });

  it("computes the support delta between two models in the same frame", async () => {
    const a = buildAtomTable(await parseCifText(SYNTH))!;
    const b = buildAtomTable(await parseCifText(SYNTH_SHIFTED))!;
    const t = mapSupportDelta(a, b, sampleX);
    // b is a shifted +3 in x, so mean_a - mean_b = -3 for every residue.
    for (let i = 0; i < t.values.length; i++) expect(t.values[i]).toBeCloseTo(-3, 5);
    expect(t.domain[0]).toBeCloseTo(-3, 5);
    expect(t.domain[1]).toBeCloseTo(3, 5);
    expect(t.metricId).toBe("support-delta");
  });
});

describe("track combinators", () => {
  const keys = (seqs: number[]) => seqs.map((seq) => ({ chain: "A", seq, ins: "" }));

  it("trackDelta matches by residue key and keeps a symmetric domain", () => {
    const a = makeTrack("m", "residue", keys([1, 2]), Float32Array.from([2, 5]));
    const b = makeTrack("m", "residue", keys([2, 3]), Float32Array.from([1, 7]));
    const d = trackDelta(a, b);
    expect(d.metricId).toBe("m-delta");
    expect(Number.isNaN(d.values[0])).toBe(true); // A/1 absent from b
    expect(d.values[1]).toBeCloseTo(4, 6); // 5 - 1
    expect(d.domain).toEqual([-4, 4]);
    expect(d.keys).toEqual(a.keys);
  });

  it("scopeTrack masks values without touching the domain", () => {
    const a = makeTrack("m", "residue", keys([1, 2]), Float32Array.from([2, 5]));
    const s = scopeTrack(a, (ref) => ref.seq === 2);
    expect(Number.isNaN(s.values[0])).toBe(true);
    expect(s.values[1]).toBeCloseTo(5, 6);
    expect(s.domain).toEqual(a.domain);
  });
});
