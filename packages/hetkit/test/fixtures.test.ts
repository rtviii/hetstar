import { describe, expect, it } from "vitest";

import { describeHeterogeneity, summarizeAltlocs } from "../src/model";
import { altlocRmsf, conformerCount, modelRmsd, occupancyEntropy } from "../src/metrics";
import { loadFixture, loadTable } from "./load";

// Invariants over the real Dynamic PDB ETL samples (values established during dataset
// scoping, 2026-08). 7a1x_qFit: qFit multiconformer, altlocs A-E, hydrogens present,
// sidechain-only splits exist. 9jd2_qFit: altlocs A-D, no hydrogens, full-residue splits
// only. 7A1X: the deposited single-conformer sibling (sparse paired 0.5/0.5 altlocs).

describe("7a1x_qFit_010.cif", () => {
  it("summarizes the qFit altloc structure", async () => {
    const table = await loadTable("7a1x_qFit_010.cif");
    const s = summarizeAltlocs(table)!;
    expect(s.altIds).toEqual(["A", "B", "C", "D", "E"]);
    // 88% of atoms carry altlocs in this file
    expect(s.atomFractionWithAltloc).toBeGreaterThan(0.85);
    // 158 multiconformer residues, 39 of them sidechain-only
    expect(s.residues.length).toBe(158);
    expect(s.residues.filter((r) => r.scope === "sidechain").length).toBe(39);
    // per-atom-group occupancies sum to 1 (within tolerance)
    expect(s.occupancySumOk).toBe(true);
    // hydrogens are present in this file
    expect(table.element.includes("H")).toBe(true);
  });

  it("computes finite altloc metrics with sane ranges", async () => {
    const table = await loadTable("7a1x_qFit_010.cif");
    const counts = conformerCount(table);
    const entropy = occupancyEntropy(table);
    const rmsf = altlocRmsf(table);
    // Letters D/E appear on heavy atoms of SOME residues, but per residue the heavy-atom
    // multiplicity tops out at 3 in this file: the apparent 4/5-way residues carry their
    // extra letters on hydrogens only (e.g. ARG A/102: heavy A/B/C, H-only D/E).
    expect(Math.max(...counts.values)).toBe(3);
    expect(Math.max(...entropy.values)).toBeLessThanOrEqual(Math.log2(5) + 1e-6);
    for (const v of rmsf.values) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...rmsf.values)).toBeGreaterThan(0.1);
  });

  it("describes the file as altloc-only heterogeneity", async () => {
    const d = describeHeterogeneity(await loadFixture("7a1x_qFit_010.cif"));
    expect(d.altlocs).not.toBeNull();
    expect(d.ensemble).toBeNull(); // single model
    expect(d.extensions).toBeNull(); // no proposal categories in qFit output
    expect(d.motion.tlsGroups).toEqual([]);
    expect(d.motion.hasAniso).toBe(false);
    expect(d.motion.bIsoRange).not.toBeNull();
  });
});

describe("9jd2_qFit_010.cif", () => {
  it("has A-D splits, no hydrogens, and no sidechain-only residues", async () => {
    const table = await loadTable("9jd2_qFit_010.cif");
    const s = summarizeAltlocs(table)!;
    expect(s.altIds).toEqual(["A", "B", "C", "D"]);
    expect(table.element.includes("H")).toBe(false);
    expect(s.residues.length).toBe(127);
    expect(s.residues.every((r) => r.scope === "full")).toBe(true);
    expect(s.occupancySumOk).toBe(true);
  });
});

describe("7A1X.cif (deposited)", () => {
  it("has sparse paired A/B altlocs at 0.5", async () => {
    const table = await loadTable("7A1X.cif");
    const s = summarizeAltlocs(table)!;
    expect(s.altIds).toEqual(["A", "B"]);
    expect(s.atomFractionWithAltloc).toBeLessThan(0.05);
    for (const r of s.residues) {
      for (const o of r.occupancies) expect(o).toBeCloseTo(0.5, 6);
    }
  });
});

describe("model-rmsd across deposited vs qFit re-refinement", () => {
  it("matches most residues and yields finite nonnegative displacements", async () => {
    const dep = await loadTable("7A1X.cif");
    const qfit = await loadTable("7a1x_qFit_010.cif");
    const t = modelRmsd(dep, qfit);
    const finite = Array.from(t.values).filter((v) => Number.isFinite(v));
    expect(finite.length).toBeGreaterThan(100);
    for (const v of finite) expect(v).toBeGreaterThanOrEqual(0);
    // re-refinement moved something
    expect(Math.max(...finite)).toBeGreaterThan(0.05);
    // self-comparison is identically zero
    const self = modelRmsd(dep, dep);
    for (const v of self.values) if (Number.isFinite(v)) expect(v).toBeLessThan(1e-6);
  });
});
