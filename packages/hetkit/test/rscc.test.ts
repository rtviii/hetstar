import { describe, expect, it } from "vitest";

import { buildAtomTable, parseCifText, type AtomTable } from "../src/model";
import { realSpaceCorrelation, resolveMetric, RSCC_DEFAULT_BLUR_FACTOR } from "../src/metrics";

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

function atomRows(shiftSecond: number): string {
  const rows = [
    ["N", 1, 0, 0, 0],
    ["CA", 1, 1.5, 0, 0],
    ["C", 1, 2.2, 1.3, 0],
    ["N", 2, 12 + shiftSecond, 0, 0],
    ["CA", 2, 13.5 + shiftSecond, 0, 0],
    ["C", 2, 14.2 + shiftSecond, 1.3, 0],
  ];
  return rows
    .map(([atom, seq, x, y, z], i) => ["ATOM", i + 1, "C", atom, ".", "ALA", "A", seq, "?", x, y, z, 1.0, 15.0, seq, "ALA", "A", 1].join(" "))
    .join("\n");
}

async function model(shiftSecond = 0): Promise<AtomTable> {
  return buildAtomTable(await parseCifText(ATOM_SITE_HEADER + atomRows(shiftSecond) + "\n"))!;
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
