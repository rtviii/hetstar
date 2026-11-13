import { describe, expect, it } from "vitest";

import { buildAtomTable, parseCifText } from "../src/model";
import {
  B_TO_MEAN_SQUARE_DISPLACEMENT,
  combineDerived,
  DERIVED_METRICS,
  makeTrack,
  motionTracks,
  resolveMetric,
  trackSpread,
} from "../src/metrics";

// Same hand-computable synthetic as synthetic.test.ts: residue A/1 with N unsplit (B 10)
// and CA split A/B at 0.5/0.5 one Angstrom apart in x (B 10 and 30), A/2 a lone CA (B 20),
// A/3 with N and CA unsplit and CB split 0.7/0.3 two Angstrom apart in y (all B 12).
// `dx` shifts every atom in x, giving a second frame of the same model.
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

async function frame(dx: number) {
  return buildAtomTable(await parseCifText(ATOM_SITE_HEADER + atomRows(dx) + "\n"))!;
}

const K = B_TO_MEAN_SQUARE_DISPLACEMENT;

describe("motion on a common scale", () => {
  it("reads the harmonic part off the B-factors", async () => {
    const { harmonic } = motionTracks([await frame(0)]);
    expect(harmonic.metricId).toBe("motion-harmonic");
    expect(harmonic.unit).toBe("A");
    // A/1: N has B 10, CA averages to 20 over its two halves; the residue mean is 15
    expect(harmonic.values[0]).toBeCloseTo(Math.sqrt(15 * K), 5);
    expect(harmonic.values[1]).toBeCloseTo(Math.sqrt(20 * K), 5);
    expect(harmonic.values[2]).toBeCloseTo(Math.sqrt(12 * K), 5);
    // B 20 is a displacement of about 0.87 A
    expect(harmonic.values[1]).toBeCloseTo(0.8717, 3);
  });

  it("reads the discrete part off the spread across altloc conformers", async () => {
    const { discrete } = motionTracks([await frame(0)]);
    // A/1: CA halves sit 0.5 A from their centroid (variance 0.25); N is unsplit (0); mean 0.125
    expect(discrete.values[0]).toBeCloseTo(Math.sqrt(0.125), 5);
    expect(discrete.values[1]).toBeCloseTo(0, 6);
    // A/3: CB centroid at y = 0.4, variance 0.7 * 0.36 + 0.3 * 1.96 = 0.84, over three atoms
    expect(discrete.values[2]).toBeCloseTo(Math.sqrt(0.84 / 3), 5);
  });

  it("adds the two parts in quadrature", async () => {
    const { total, harmonic, discrete } = motionTracks([await frame(0)]);
    expect(total.values[0]).toBeCloseTo(Math.sqrt(15 * K + 0.125), 5);
    for (let i = 0; i < 3; i++) {
      expect(total.values[i]).toBeCloseTo(Math.hypot(harmonic.values[i], discrete.values[i]), 5);
    }
  });

  it("treats ensemble members as equally weighted states", async () => {
    const members = [await frame(0), await frame(3)];
    const { discrete, harmonic } = motionTracks(members);
    // A/2: the lone CA sits at two positions 3 A apart, variance 1.5^2
    expect(discrete.values[1]).toBeCloseTo(1.5, 5);
    // A/1: the member shift adds 2.25 to every atom's variance on top of the altloc split
    expect(discrete.values[0]).toBeCloseTo(Math.sqrt(2.25 + 0.125), 5);
    // the B-factors are the same in both members, so the harmonic part does not change
    expect(harmonic.values[1]).toBeCloseTo(Math.sqrt(20 * K), 5);
  });

  it("is served by the resolver for single models and ensembles alike", async () => {
    const single = await frame(0);
    const members = [await frame(0), await frame(3)];
    expect(resolveMetric("motion-total", { table: single })).toEqual({ track: motionTracks([single]).total });
    expect(resolveMetric("motion-discrete", { table: members[0], members })).toEqual({
      track: motionTracks(members).discrete,
    });
  });
});

describe("comparing a metric across models", () => {
  const ref = (seq: number) => ({ chain: "A", seq, ins: "" });
  const track = (values: number[], seqs = [1, 2, 3]) =>
    makeTrack("motion-total", "residue", seqs.map(ref), Float32Array.from(values), { unit: "A" });

  it("takes the range across the tracks that have a value", () => {
    const spread = trackSpread(track([1, 2, NaN]), [track([1.5, 5, 4]), track([0.5, 7], [1, 3])]);
    expect(spread.keys).toEqual([ref(1), ref(2), ref(3)]);
    expect(spread.values[0]).toBeCloseTo(1, 6);
    // only two models describe residue 2
    expect(spread.values[1]).toBeCloseTo(3, 6);
    // residue 3: the own value is missing, the other two still disagree by 3
    expect(spread.values[2]).toBeCloseTo(3, 6);
    expect(spread.unit).toBe("A");
  });

  it("leaves a residue undefined when fewer than two models describe it", () => {
    const spread = trackSpread(track([1, 2, 3]), [track([4], [1])]);
    expect(spread.values[0]).toBeCloseTo(3, 6);
    expect(Number.isNaN(spread.values[1])).toBe(true);
  });

  it("builds the derived motion metrics from per-model totals", () => {
    const own = track([1, 2, 3]);
    const other = track([0.5, 2.5, 3]);
    const delta = combineDerived(DERIVED_METRICS.get("motion-delta")!, own, [other])!;
    expect(delta.metricId).toBe("motion-delta");
    expect(Array.from(delta.values)).toEqual([0.5, -0.5, 0]);
    expect(delta.domain).toEqual([-0.5, 0.5]);
    const spread = combineDerived(DERIVED_METRICS.get("motion-spread")!, own, [other])!;
    expect(spread.metricId).toBe("motion-spread");
    expect(Array.from(spread.values)).toEqual([0.5, 0.5, 0]);
    expect(combineDerived(DERIVED_METRICS.get("motion-spread")!, own, [])).toBeNull();
  });
});
