import { describe, expect, it } from "vitest";

import { buildAtomTable, parseCifText } from "../src/model";
import {
  altlocRmsf,
  bIsoMean,
  conformerCount,
  ensembleRmsf,
  mapSupportDelta,
  mapValueTracks,
  metricNeeds,
  modelRmsd,
  occupancyEntropy,
  resolveMetric,
  storedResidueTracks,
  trackDelta,
} from "../src/metrics";

// Same hand-computable synthetic as synthetic.test.ts; `dx` shifts every atom in x, giving
// a second model in the same frame.
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

async function tables() {
  const table = buildAtomTable(await parseCifText(ATOM_SITE_HEADER + atomRows(0) + "\n"))!;
  const shifted = buildAtomTable(await parseCifText(ATOM_SITE_HEADER + atomRows(3) + "\n"))!;
  return { table, shifted };
}

const sampleX = (x: number) => x;
const sampleConstant = () => 100;

describe("metric engine", () => {
  it("resolves single-model metrics to the direct computation", async () => {
    const { table } = await tables();
    expect(resolveMetric("conformer-count", { table })).toEqual({ track: conformerCount(table) });
    expect(resolveMetric("occupancy-entropy", { table })).toEqual({ track: occupancyEntropy(table) });
    expect(resolveMetric("altloc-rmsf", { table })).toEqual({ track: altlocRmsf(table) });
    expect(resolveMetric("b-iso-mean", { table })).toEqual({ track: bIsoMean(table) });
  });

  it("asks for a reference before computing a pair metric", async () => {
    const { table, shifted } = await tables();
    expect(resolveMetric("model-rmsd", { table })).toEqual({ missing: "reference" });
    expect(resolveMetric("model-rmsd", { table, reference: null })).toEqual({ missing: "reference" });
    expect(resolveMetric("model-rmsd", { table, reference: shifted })).toEqual({ track: modelRmsd(table, shifted) });
  });

  it("computes the altloc RMSF delta as model minus reference", async () => {
    const { table, shifted } = await tables();
    const resolved = resolveMetric("altloc-rmsf-delta", { table, reference: shifted });
    const expected = trackDelta(altlocRmsf(table), altlocRmsf(shifted), { metricId: "altloc-rmsf-delta" });
    expect(resolved).toEqual({ track: expected });
    expect("track" in resolved && resolved.track.metricId).toBe("altloc-rmsf-delta");
  });

  it("asks for at least two members before computing an ensemble metric", async () => {
    const { table, shifted } = await tables();
    expect(resolveMetric("ensemble-rmsf", { table })).toEqual({ missing: "ensemble" });
    expect(resolveMetric("ensemble-rmsf", { table, members: [table] })).toEqual({ missing: "ensemble" });
    expect(resolveMetric("ensemble-rmsf", { table, members: [table, shifted] })).toEqual({
      track: ensembleRmsf([table, shifted]),
    });
  });

  it("samples the map each metric names", async () => {
    const { table, shifted } = await tables();
    const fofc = mapValueTracks(table, sampleX, { idPrefix: "fofc" });
    const maps = { twoFoFc: sampleConstant, foFc: sampleX };
    expect(resolveMetric("fofc-mean", { table, maps })).toEqual({ track: fofc.mean });
    expect(resolveMetric("fofc-peak", { table, maps })).toEqual({ track: fofc.peak });
    expect(resolveMetric("fofc-mean", { table, maps: { twoFoFc: sampleConstant } })).toEqual({ missing: "map" });
    expect(resolveMetric("support-delta", { table, reference: shifted, maps: { twoFoFc: sampleX, foFc: sampleConstant } })).toEqual({
      track: mapSupportDelta(table, shifted, sampleX),
    });
  });

  it("reports the reference before the map for a pair-map metric", async () => {
    const { table, shifted } = await tables();
    expect(resolveMetric("support-delta", { table })).toEqual({ missing: "reference" });
    expect(resolveMetric("support-delta", { table, reference: shifted })).toEqual({ missing: "map" });
  });

  it("reports an unknown metric id", async () => {
    const { table } = await tables();
    expect(resolveMetric("no-such-metric", { table })).toEqual({ missing: "unknown" });
    expect(metricNeeds("no-such-metric")).toBeNull();
  });

  it("derives each metric's needs from its registry entry", () => {
    const none = { reference: false, ensemble: false, states: false, map: null };
    expect(metricNeeds("b-iso-mean")).toEqual(none);
    expect(metricNeeds("model-rmsd")).toEqual({ ...none, reference: true });
    expect(metricNeeds("altloc-rmsf-delta")).toEqual({ ...none, reference: true });
    expect(metricNeeds("ensemble-rmsf")).toEqual({ ...none, ensemble: true });
    expect(metricNeeds("motion-total")).toEqual({ ...none, states: true });
    expect(metricNeeds("fofc-peak")).toEqual({ ...none, map: "fofc" });
    expect(metricNeeds("support-delta")).toEqual({ ...none, reference: true, map: "2fofc" });
  });
});

describe("stored residue tracks", () => {
  const ref = (seq: number) => ({ chain: "A", seq, ins: "" });

  it("turns catalogue rows into one track per stored field", () => {
    const tracks = storedResidueTracks([
      { ref: ref(1), rscc: 0.95, bIso: 12, occupancy: 1 },
      { ref: ref(2), rscc: null, bIso: 30, occupancy: 0.5 },
      { ref: ref(3), rscc: 0.7, bIso: null, occupancy: 1 },
    ]);
    const rscc = tracks["stored-rscc"]!;
    expect(rscc.metricId).toBe("stored-rscc");
    expect(rscc.keys).toEqual([ref(1), ref(2), ref(3)]);
    expect(rscc.values[0]).toBeCloseTo(0.95, 6);
    expect(Number.isNaN(rscc.values[1])).toBe(true);
    expect(rscc.domain[0]).toBeCloseTo(0.7, 6);
    expect(rscc.domain[1]).toBeCloseTo(0.95, 6);
    const b = tracks["stored-b-iso"]!;
    expect(b.unit).toBe("A^2");
    expect(Number.isNaN(b.values[2])).toBe(true);
    expect(tracks["stored-occupancy"]!.values[1]).toBeCloseTo(0.5, 6);
  });

  it("omits a field no row carries", () => {
    const tracks = storedResidueTracks([
      { ref: ref(1), rscc: null, bIso: 12, occupancy: null },
      { ref: ref(2), rscc: null, bIso: 14, occupancy: null },
    ]);
    expect(Object.keys(tracks)).toEqual(["stored-b-iso"]);
    expect(storedResidueTracks([])).toEqual({});
  });

  it("keeps the first row of a residue listed twice", () => {
    const tracks = storedResidueTracks([
      { ref: ref(1), rscc: 0.9, bIso: null, occupancy: null },
      { ref: ref(1), rscc: 0.1, bIso: null, occupancy: null },
    ]);
    expect(tracks["stored-rscc"]!.keys).toHaveLength(1);
    expect(tracks["stored-rscc"]!.values[0]).toBeCloseTo(0.9, 6);
  });
});
