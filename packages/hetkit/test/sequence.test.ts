import { describe, expect, it } from "vitest";

import {
  buildSequenceModel,
  isPolymerComp,
  positionOf,
  readSecondaryStructure,
  refAt,
  residueKey,
  unobservedSpans,
} from "../src/model";
import { loadFixture, loadTable } from "./load";

// The structure-sequence bridge. 7A1X.cif is a wwPDB deposition (has _pdbx_poly_seq_scheme,
// _struct_conf, _struct_sheet_range); its qFit sibling 7a1x_qFit_010.cif carries atom_site
// only, with the same author numbering. The bridge must frame the qFit model with the
// deposited scheme, and still work from atom_site alone.

describe("buildSequenceModel from _pdbx_poly_seq_scheme (7A1X.cif)", () => {
  it("reads the full SEQRES per chain with author numbering", async () => {
    const file = await loadFixture("7A1X.cif");
    const table = await loadTable("7A1X.cif");
    const model = buildSequenceModel(file, table);
    const a = model.byChain.get("A")!;
    expect(a).toBeDefined();
    expect(a.source).toBe("poly_seq_scheme");
    expect(a.positionsAreLabelSeq).toBe(true);
    expect(a.labelAsymId).toBe("A");
    expect(a.entityId).toBe("1");
    // the scheme starts GLY(0) MET(1) THR(2) GLU(3) ...
    expect(a.letters.startsWith("GMTEYKLVVVGACGVGKS")).toBe(true);
    expect(a.positions[0]).toMatchObject({ pos: 1, compId: "GLY", letter: "G", ref: { chain: "A", seq: 0, ins: "" } });
    expect(a.positions[1].ref).toEqual({ chain: "A", seq: 1, ins: "" });
    expect(a.length).toBe(a.positions.length);
    a.positions.forEach((p, i) => expect(p.pos).toBe(i + 1));
  });

  it("marks observed residues from the table and maps both ways", async () => {
    const file = await loadFixture("7A1X.cif");
    const table = await loadTable("7A1X.cif");
    const model = buildSequenceModel(file, table);
    const a = model.byChain.get("A")!;
    // every polymer residue of the model sits at a position, and is observed there
    for (const res of table.residues) {
      if (res.ref.chain !== "A" || !isPolymerComp(res.compId)) continue;
      const pos = positionOf(model, res.ref);
      expect(pos).not.toBeNull();
      expect(a.positions[pos! - 1].observed).toBe(true);
      expect(a.positions[pos! - 1].compId).toBe(res.compId);
      expect(refAt(a, pos!)).toEqual(res.ref);
    }
    // an observed position round-trips through residueKey
    const observed = a.positions.filter((p) => p.observed);
    expect(observed.length).toBeGreaterThan(100);
    for (const p of observed.slice(0, 20)) expect(a.posByKey.get(residueKey(p.ref!))).toBe(p.pos);
    // unobserved runs never include an observed position and stay inside the chain
    for (const span of unobservedSpans(a)) {
      expect(span.start).toBeGreaterThanOrEqual(1);
      expect(span.end).toBeLessThanOrEqual(a.length);
      for (let pos = span.start; pos <= span.end; pos++) expect(a.positions[pos - 1].observed).toBe(false);
    }
  });

  it("frames the qFit sibling with the deposited scheme", async () => {
    const scheme = await loadFixture("7A1X.cif");
    const qfit = await loadTable("7a1x_qFit_010.cif");
    const model = buildSequenceModel(scheme, qfit);
    const a = model.byChain.get("A")!;
    expect(a.source).toBe("poly_seq_scheme");
    let mapped = 0;
    for (const res of qfit.residues) {
      if (res.ref.chain !== "A" || !isPolymerComp(res.compId)) continue;
      const pos = positionOf(model, res.ref);
      expect(pos).not.toBeNull();
      expect(a.positions[pos! - 1].observed).toBe(true);
      mapped++;
    }
    expect(mapped).toBeGreaterThan(100);
  });

  it("reads helices and strands in positions", async () => {
    const file = await loadFixture("7A1X.cif");
    const model = buildSequenceModel(file, await loadTable("7A1X.cif"));
    const ss = readSecondaryStructure(file, model);
    const a = ss.get("A")!;
    expect(a).toBeDefined();
    expect(a.some((s) => s.kind === "helix")).toBe(true);
    expect(a.some((s) => s.kind === "strand")).toBe(true);
    const length = model.byChain.get("A")!.length;
    for (const s of a) {
      expect(s.start).toBeGreaterThanOrEqual(1);
      expect(s.end).toBeGreaterThanOrEqual(s.start);
      expect(s.end).toBeLessThanOrEqual(length);
    }
    expect(a).toEqual([...a].sort((x, y) => x.start - y.start));
  });
});

describe("buildSequenceModel from atom_site alone (qFit output)", () => {
  it("frames the observed polymer residues, no ligands or waters", async () => {
    const file = await loadFixture("7a1x_qFit_010.cif");
    const table = await loadTable("7a1x_qFit_010.cif");
    const model = buildSequenceModel(file, table);
    const a = model.byChain.get("A")!;
    expect(a).toBeDefined();
    expect(a.source).toBe("atom_site");
    const polymer = table.residues.filter((r) => r.ref.chain === "A" && isPolymerComp(r.compId));
    // every polymer residue has a position and every filled position is a polymer residue
    for (const res of polymer) expect(positionOf(model, res.ref)).not.toBeNull();
    const filled = a.positions.filter((p) => p.ref !== null);
    expect(filled.length).toBe(polymer.length);
    for (const p of filled) expect(isPolymerComp(p.compId)).toBe(true);
    expect(a.letters.length).toBe(a.length);
    // no secondary structure without the categories
    expect(readSecondaryStructure(file, model).size).toBe(0);
  });

  it("agrees with the deposited scheme on letters at shared author numbers", async () => {
    const dep = buildSequenceModel(await loadFixture("7A1X.cif"), await loadTable("7A1X.cif"));
    const qfitFile = await loadFixture("7a1x_qFit_010.cif");
    const qfit = buildSequenceModel(qfitFile, await loadTable("7a1x_qFit_010.cif"));
    const a = qfit.byChain.get("A")!;
    for (const p of a.positions) {
      if (!p.ref) continue;
      const depPos = positionOf(dep, p.ref);
      if (depPos === null) continue;
      expect(dep.byChain.get("A")!.positions[depPos - 1].letter).toBe(p.letter);
    }
  });
});
