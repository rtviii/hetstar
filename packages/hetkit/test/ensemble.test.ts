import { describe, expect, it } from "vitest";

import { buildAtomTable, parseCifText, summarizeEnsemble } from "../src/model";
import { ensembleRmsf } from "../src/metrics";

// A two-member ensemble: model 2 is model 1 translated +1 A in x. Every atom's mean sits
// halfway, so the per-atom (and per-residue) RMSF is exactly 0.5 A.
const HEADER = `data_ens
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

function memberRows(dx: number, modelNum: number, idBase: number): string {
  const rows = [
    [idBase + 1, "N", "N", "ALA", 1, 0 + dx, 0, 1],
    [idBase + 2, "C", "CA", "ALA", 1, 0 + dx, 0, 0],
    [idBase + 3, "C", "CA", "GLY", 2, 5 + dx, 0, 0],
  ];
  return rows
    .map(([id, el, atom, comp, seq, x, y, z]) =>
      ["ATOM", id, el, atom, ".", comp, "A", seq, "?", x, y, z, 1.0, 10.0, seq, comp, "A", modelNum].join(" "),
    )
    .join("\n");
}

const ENSEMBLE = HEADER + memberRows(0, 1, 0) + "\n" + memberRows(1, 2, 10) + "\n";

describe("multi-MODEL ensembles", () => {
  it("summarizeEnsemble counts the members", async () => {
    const file = await parseCifText(ENSEMBLE);
    expect(summarizeEnsemble(file)).toEqual({ modelCount: 2, modelNums: [1, 2] });
  });

  it("buildAtomTable keeps the first model by default and the requested one via modelNum", async () => {
    const file = await parseCifText(ENSEMBLE);
    const t1 = buildAtomTable(file)!;
    expect(t1.count).toBe(3);
    expect(t1.modelNum).toBe(1);
    expect(t1.x[0]).toBeCloseTo(0, 8);
    const t2 = buildAtomTable(file, { modelNum: 2 })!;
    expect(t2.count).toBe(3);
    expect(t2.modelNum).toBe(2);
    expect(t2.x[0]).toBeCloseTo(1, 8);
  });

  it("ensembleRmsf of two members 1 A apart is 0.5 A everywhere, and 0 for identical members", async () => {
    const file = await parseCifText(ENSEMBLE);
    const t1 = buildAtomTable(file)!;
    const t2 = buildAtomTable(file, { modelNum: 2 })!;
    const track = ensembleRmsf([t1, t2]);
    expect(track.keys.length).toBe(2);
    for (const v of track.values) expect(v).toBeCloseTo(0.5, 6);
    const still = ensembleRmsf([t1, t1]);
    for (const v of still.values) expect(v).toBeCloseTo(0, 8);
  });
});
