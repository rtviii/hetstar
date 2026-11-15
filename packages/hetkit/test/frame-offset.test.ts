import { describe, expect, it } from "vitest";

import { buildAtomTable, parseCifText } from "../src/model";
import { frameOffset } from "../src/metrics";

// Three residues on the x axis: A/1 with its CA split A/B at 0.5/0.5 one angstrom apart,
// A/2 a lone CA, A/3 with N and CA. `shift` moves every atom in x; `withThird` drops A/3.
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

async function model(shift: number, withThird = true) {
  const rows: (string | number)[][] = [
    ["ATOM", 1, "C", "CA", "A", "ALA", 1, 0 + shift, 0, 0, 0.5, 10.0, 1],
    ["ATOM", 2, "C", "CA", "B", "ALA", 1, 1 + shift, 0, 0, 0.5, 10.0, 1],
    ["ATOM", 3, "C", "CA", ".", "GLY", 2, 5 + shift, 0, 0, 1.0, 10.0, 2],
  ];
  if (withThird) {
    rows.push(["ATOM", 4, "N", "N", ".", "SER", 3, 8 + shift, 0, 0, 1.0, 10.0, 3]);
    rows.push(["ATOM", 5, "C", "CA", ".", "SER", 3, 9 + shift, 0, 0, 1.0, 10.0, 3]);
  }
  const text = rows
    .map(([g, id, el, atom, alt, comp, seq, x, y, z, occ, b, aseq]) =>
      [g, id, el, atom, alt, comp, "A", seq, "?", x, y, z, occ, b, aseq, comp, "A", 1].join(" "),
    )
    .join("\n");
  return buildAtomTable(await parseCifText(`${ATOM_SITE_HEADER}${text}\n`))!;
}

describe("frameOffset", () => {
  it("should_be_zero_when_both_models_sit_in_the_same_frame", async () => {
    // given
    const a = await model(0);
    const b = await model(0);

    // when
    const offset = frameOffset(a, b);

    // then
    expect(offset.matched).toBe(3);
    expect(offset.mean).toBeCloseTo(0, 6);
  });

  it("should_report_the_shift_when_one_model_was_filed_in_another_frame", async () => {
    // given
    const a = await model(0);
    const b = await model(4);

    // when
    const offset = frameOffset(a, b);

    // then
    expect(offset.matched).toBe(3);
    expect(offset.mean).toBeCloseTo(4, 5);
  });

  it("should_count_only_the_residues_both_models_have", async () => {
    // given
    const a = await model(0);
    const b = await model(2, false);

    // when
    const offset = frameOffset(a, b);

    // then
    expect(offset.matched).toBe(2);
    expect(offset.mean).toBeCloseTo(2, 5);
  });

  it("should_be_nan_when_no_residue_is_shared", async () => {
    // given
    const a = await model(0);
    const empty = { ...a, residueIndex: new Map<string, number>() };

    // when
    const offset = frameOffset(a, empty);

    // then
    expect(offset.matched).toBe(0);
    expect(Number.isNaN(offset.mean)).toBe(true);
  });
});
