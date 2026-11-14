import { describe, expect, it } from "vitest";

import { buildAtomTable, parseCifText, type AtomTable } from "../src/model";
import {
  realSpaceCorrelation,
  realSpaceCorrelationJoint,
  realSpaceCorrelationOfSelection,
  resolveMetric,
  RSCC_DEFAULT_BLUR_FACTOR,
} from "../src/metrics";

// Two residues 12 Angstrom apart, three carbons each, so their masks do not overlap.
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

function atomRows(shiftSecond: number, secondComp: string | null): string {
  const rows = [
    ["N", 1, 0, 0, 0],
    ["CA", 1, 1.5, 0, 0],
    ["C", 1, 2.2, 1.3, 0],
    ["N", 2, 12 + shiftSecond, 0, 0],
    ["CA", 2, 13.5 + shiftSecond, 0, 0],
    ["C", 2, 14.2 + shiftSecond, 1.3, 0],
  ].filter(([, seq]) => seq === 1 || secondComp !== null);
  return rows
    .map(([atom, seq, x, y, z], i) => {
      const comp = seq === 1 ? "ALA" : secondComp;
      return ["ATOM", i + 1, "C", atom, ".", comp, "A", seq, "?", x, y, z, 1.0, 15.0, seq, comp, "A", 1].join(" ");
    })
    .join("\n");
}

/** `secondComp` names the second residue; null leaves it out of the model */
async function model(shiftSecond = 0, secondComp: string | null = "ALA"): Promise<AtomTable> {
  return buildAtomTable(await parseCifText(ATOM_SITE_HEADER + atomRows(shiftSecond, secondComp) + "\n"))!;
}

const RESOLUTION = 1.6;

// the map a perfect model would give: the same Gaussians the metric simulates
function mapOf(table: AtomTable) {
  const width = 15 + RSCC_DEFAULT_BLUR_FACTOR * RESOLUTION * RESOLUTION;
  const exponent = (4 * Math.PI * Math.PI) / width;
  return (x: number, y: number, z: number) => {
    let density = 0;
    for (let row = 0; row < table.count; row++) {
      const dx = x - table.x[row];
      const dy = y - table.y[row];
      const dz = z - table.z[row];
      density += Math.exp(-exponent * (dx * dx + dy * dy + dz * dz));
    }
    return density;
  };
}

describe("computed real-space correlation", () => {
  it("is 1 for a model against its own density", async () => {
    const table = await model();
    const track = realSpaceCorrelation([table], mapOf(table), { resolution: RESOLUTION });
    expect(track.metricId).toBe("rscc-computed");
    expect(track.values[0]).toBeGreaterThan(0.999);
    expect(track.values[1]).toBeGreaterThan(0.999);
  });

  it("drops only where the model leaves the density", async () => {
    const truth = await model();
    const moved = await model(2.5);
    const track = realSpaceCorrelation([moved], mapOf(truth), { resolution: RESOLUTION });
    expect(track.values[0]).toBeGreaterThan(0.999);
    expect(track.values[1]).toBeLessThan(0.5);
  });

  it("does not depend on the scale or offset of the map", async () => {
    const table = await model();
    const map = mapOf(table);
    const track = realSpaceCorrelation([table], (x, y, z) => 3 * map(x, y, z) - 7, { resolution: RESOLUTION });
    expect(track.values[0]).toBeGreaterThan(0.999);
  });

  it("is undefined where the map has no data", async () => {
    const table = await model();
    const map = mapOf(table);
    const track = realSpaceCorrelation([table], (x, y, z) => (x > 6 ? NaN : map(x, y, z)), { resolution: RESOLUTION });
    expect(track.values[0]).toBeGreaterThan(0.999);
    expect(Number.isNaN(track.values[1])).toBe(true);
  });

  it("averages the members of an ensemble into one density", async () => {
    const left = await model(-1);
    const right = await model(1);
    const both = mapOf(left);
    const rightMap = mapOf(right);
    const blended = (x: number, y: number, z: number) => both(x, y, z) + rightMap(x, y, z);
    const ensemble = realSpaceCorrelation([left, right], blended, { resolution: RESOLUTION });
    const single = realSpaceCorrelation([left], blended, { resolution: RESOLUTION });
    expect(ensemble.values[1]).toBeGreaterThan(0.999);
    expect(single.values[1]).toBeLessThan(ensemble.values[1]);
  });

  it("is served by the resolver once a map is there", async () => {
    const table = await model();
    expect(resolveMetric("rscc-computed", { table })).toEqual({ missing: "map" });
    const resolved = resolveMetric("rscc-computed", { table, maps: { twoFoFc: mapOf(table) }, resolution: RESOLUTION });
    expect("track" in resolved && resolved.track.values[0]).toBeGreaterThan(0.999);
  });
});

// One residue in two places, 2 A apart: the map holds both, as it would for a residue with
// two conformers. `single` models the left place only, `both` models the two.
describe("real-space correlation of several models on one lattice", () => {
  async function twoPlaces() {
    const left = await model(-1);
    const right = await model(1);
    const leftMap = mapOf(left);
    const rightMap = mapOf(right);
    const map = (x: number, y: number, z: number) => leftMap(x, y, z) + rightMap(x, y, z);
    return { single: [left], both: [left, right], map };
  }

  it("gives one model on its own mask the value of the one-model function", async () => {
    const { both, map } = await twoPlaces();
    const alone = realSpaceCorrelation(both, map, { resolution: RESOLUTION });
    const [joint] = realSpaceCorrelationJoint([both], map, { resolution: RESOLUTION, mask: "own" });
    expect(Array.from(joint.values)).toEqual(Array.from(alone.values));
  });

  it("marks a model down, under the union, for density near the other model's atoms that it leaves unexplained", async () => {
    const { single, both, map } = await twoPlaces();
    const own = realSpaceCorrelationJoint([single, both], map, { resolution: RESOLUTION, mask: "own" });
    const union = realSpaceCorrelationJoint([single, both], map, { resolution: RESOLUTION, mask: "union" });
    // the model that accounts for both places is right on any set of points
    expect(own[1].values[1]).toBeGreaterThan(0.999);
    expect(union[1].values[1]).toBeGreaterThan(0.999);
    // the one-place model is judged over the second place too, and loses
    expect(union[0].values[1]).toBeLessThan(own[0].values[1] - 0.02);
    // the residue both models place identically is unaffected
    expect(union[0].values[0]).toBeGreaterThan(0.999);
    expect(union[1].values[0]).toBeGreaterThan(0.999);
  });

  it("scores every model over one model's mask when the rule names it", async () => {
    const { single, both, map } = await twoPlaces();
    const own = realSpaceCorrelationJoint([single, both], map, { resolution: RESOLUTION, mask: "own" });
    const ofSingle = realSpaceCorrelationJoint([single, both], map, { resolution: RESOLUTION, mask: { of: 0 } });
    const ofBoth = realSpaceCorrelationJoint([single, both], map, { resolution: RESOLUTION, mask: { of: 1 } });
    const union = realSpaceCorrelationJoint([single, both], map, { resolution: RESOLUTION, mask: "union" });
    expect(Array.from(ofSingle[0].values)).toEqual(Array.from(own[0].values));
    expect(Array.from(ofBoth[1].values)).toEqual(Array.from(own[1].values));
    // the two-place model's mask contains the one-place model's, so it is the union
    expect(Array.from(ofBoth[0].values)).toEqual(Array.from(union[0].values));
  });

  it("scores the intersection over the points every model covers", async () => {
    const { single, both, map } = await twoPlaces();
    const own = realSpaceCorrelationJoint([single, both], map, { resolution: RESOLUTION, mask: "own" });
    const intersection = realSpaceCorrelationJoint([single, both], map, { resolution: RESOLUTION, mask: "intersection" });
    // the one-place model's mask lies inside the other's, so it is the intersection
    expect(Array.from(intersection[0].values)).toEqual(Array.from(own[0].values));
    expect(intersection[1].values[1]).toBeGreaterThan(0.999);
  });

  it("scores a residue only one model has over that model's own mask", async () => {
    const full = await model();
    const short = await model(0, null);
    const map = mapOf(full);
    const [fullTrack, shortTrack] = realSpaceCorrelationJoint([[full], [short]], map, { resolution: RESOLUTION, mask: "union" });
    expect(fullTrack.values.length).toBe(2);
    expect(shortTrack.values.length).toBe(1);
    expect(fullTrack.values[1]).toBeGreaterThan(0.999);
  });

  it("leaves residues outside `include` unscored and still in the density", async () => {
    const table = await model();
    const [track] = realSpaceCorrelationJoint([[table]], mapOf(table), {
      resolution: RESOLUTION,
      include: (residue) => residue.ref.seq === 1,
    });
    expect(track.values[0]).toBeGreaterThan(0.999);
    expect(Number.isNaN(track.values[1])).toBe(true);
  });
});

describe("RSCC against the reference on a shared mask", () => {
  it("needs a reference and a map", async () => {
    const table = await model();
    expect(resolveMetric("rscc-delta", { table, maps: { twoFoFc: mapOf(table) } })).toEqual({ missing: "reference" });
    expect(resolveMetric("rscc-delta", { table, reference: table })).toEqual({ missing: "map" });
  });

  it("is zero between identical models and negative where the model leaves the density", async () => {
    const truth = await model();
    const moved = await model(2.5);
    const maps = { twoFoFc: mapOf(truth) };
    const same = resolveMetric("rscc-delta", { table: truth, reference: truth, maps, resolution: RESOLUTION });
    const worse = resolveMetric("rscc-delta", { table: moved, reference: truth, maps, resolution: RESOLUTION });
    if (!("track" in same) || !("track" in worse)) throw new Error("expected tracks");
    expect(same.track.metricId).toBe("rscc-delta");
    expect(Math.abs(same.track.values[0])).toBeLessThan(1e-6);
    expect(Math.abs(same.track.values[1])).toBeLessThan(1e-6);
    expect(Math.abs(worse.track.values[0])).toBeLessThan(1e-3);
    expect(worse.track.values[1]).toBeLessThan(-0.3);
  });

  it("is positive where an ensemble accounts for density the reference does not", async () => {
    const left = await model(-1);
    const right = await model(1);
    const leftMap = mapOf(left);
    const rightMap = mapOf(right);
    const maps = { twoFoFc: (x: number, y: number, z: number) => leftMap(x, y, z) + rightMap(x, y, z) };
    const resolved = resolveMetric("rscc-delta", { table: left, members: [left, right], reference: left, maps, resolution: RESOLUTION });
    if (!("track" in resolved)) throw new Error("expected a track");
    expect(resolved.track.values[1]).toBeGreaterThan(0.02);
  });

  it("has no value for residues that are not polymer or that the reference lacks", async () => {
    const truth = await model();
    const withWater = await model(0, "HOH");
    const short = await model(0, null);
    const maps = { twoFoFc: mapOf(truth) };
    const water = resolveMetric("rscc-delta", { table: withWater, reference: withWater, maps, resolution: RESOLUTION });
    const lacking = resolveMetric("rscc-delta", { table: truth, reference: short, maps, resolution: RESOLUTION });
    if (!("track" in water) || !("track" in lacking)) throw new Error("expected tracks");
    expect(Number.isNaN(water.track.values[1])).toBe(true);
    expect(Math.abs(lacking.track.values[0])).toBeLessThan(1e-6);
    expect(Number.isNaN(lacking.track.values[1])).toBe(true);
  });
});

describe("real-space correlation of a selection of atoms", () => {
  const second = (residue: { ref: { seq: number } }) => residue.ref.seq === 2;

  it("gives one number over the whole selection and one per residue in it", async () => {
    const table = await model();
    const whole = realSpaceCorrelationOfSelection([[table]], mapOf(table), { resolution: RESOLUTION, select: () => true });
    expect(whole.pooled[0].value).toBeGreaterThan(0.999);
    expect(whole.residues[0].keys.map((key) => key.seq)).toEqual([1, 2]);
    // a selection of one residue is that residue: the pooled number and the residue's agree
    const one = realSpaceCorrelationOfSelection([[table]], mapOf(table), { resolution: RESOLUTION, select: second });
    expect(one.residues[0].keys.map((key) => key.seq)).toEqual([2]);
    expect(one.residues[0].values[0]).toBe(Math.fround(one.pooled[0].value));
    expect(one.pooled[0].points).toBeLessThan(whole.pooled[0].points);
  });

  it("agrees with the per-residue metric, which uses another lattice", async () => {
    const truth = await model();
    const moved = await model(1);
    const track = realSpaceCorrelation([moved], mapOf(truth), { resolution: RESOLUTION });
    const selection = realSpaceCorrelationOfSelection([[moved]], mapOf(truth), { resolution: RESOLUTION, select: second });
    expect(Math.abs(selection.pooled[0].value - track.values[1])).toBeLessThan(0.02);
  });

  it("takes only the named atoms of a residue", async () => {
    const table = await model();
    const residue = realSpaceCorrelationOfSelection([[table]], mapOf(table), { resolution: RESOLUTION, select: second });
    const atom = realSpaceCorrelationOfSelection([[table]], mapOf(table), {
      resolution: RESOLUTION,
      select: (entry) => (entry.ref.seq === 2 ? new Set(["CA"]) : false),
    });
    expect(atom.pooled[0].points).toBeGreaterThan(0);
    expect(atom.pooled[0].points).toBeLessThan(residue.pooled[0].points);
    expect(atom.pooled[0].value).toBeGreaterThan(0.999);
  });

  it("scores every model over the union of their masks by default", async () => {
    const left = await model(-1);
    const right = await model(1);
    const leftMap = mapOf(left);
    const rightMap = mapOf(right);
    const map = (x: number, y: number, z: number) => leftMap(x, y, z) + rightMap(x, y, z);
    const { pooled } = realSpaceCorrelationOfSelection([[left], [left, right]], map, { resolution: RESOLUTION, select: second });
    expect(pooled[0].points).toBe(pooled[1].points);
    expect(pooled[1].value).toBeGreaterThan(0.999);
    expect(pooled[0].value).toBeLessThan(pooled[1].value - 0.02);
  });

  it("has no number for a model without the selected atoms", async () => {
    const full = await model();
    const short = await model(0, null);
    const { pooled, residues } = realSpaceCorrelationOfSelection([[full], [short]], mapOf(full), { resolution: RESOLUTION, select: second });
    expect(pooled[0].value).toBeGreaterThan(0.999);
    expect(Number.isNaN(pooled[1].value)).toBe(true);
    expect(pooled[1].points).toBe(0);
    expect(residues[1].keys.length).toBe(0);
  });
});
