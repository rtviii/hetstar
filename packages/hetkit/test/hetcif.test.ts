import { describe, expect, it } from "vitest";

import {
  describeHeterogeneity,
  hetcifComponents,
  hetcifMarginals,
  hetcifStateRows,
  hetcifTopWorld,
  buildHetcifRowIndex,
  hetcifWorlds,
  hiddenRowsForWorld,
  parseHetcif,
  rowsToSelectors,
} from "../src/model";
import { loadFixture, loadTable } from "./load";

// Contract with the Python package in ~/dev/hetcif: the fixtures are its examples/hetcif
// files and the numbers below are what `hetcif worlds` / `hetcif info` print for them.

describe("constructed_two_pocket.cif", () => {
  it("reads one joint variable with six stated states", async () => {
    const m = parseHetcif(await loadFixture("constructed_two_pocket.cif"))!;
    expect([...m.variables.keys()]).toEqual(["edo_site"]);
    const v = m.variables.get("edo_site")!;
    expect(v.states.map((s) => s.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(v.provenance).toBe("assert");
    expect(hetcifWorlds(m)).toHaveLength(6);
    expect(hetcifTopWorld(m)).toEqual({ edo_site: "3" });
  });

  it("hides the other states' rows but keeps rows shared with the chosen state", async () => {
    const file = await loadFixture("constructed_two_pocket.cif");
    const m = parseHetcif(file)!;
    const table = await loadTable("constructed_two_pocket.cif");
    const index = buildHetcifRowIndex(table, m);
    const rows = hetcifStateRows(index, "edo_site");
    expect(rows.get("4")!.length).toBe(8); // EDO1 (4 atoms) + EDO2 (4 atoms)
    const hidden = hiddenRowsForWorld(index, { edo_site: "4" });
    // residues 501 and 502 have 7 + 4 + 4 + 4 = 19 altloc rows; world 4 keeps 8 of them
    expect(hidden.length).toBe(19 - 8);
    for (const i of hidden) expect(rows.get("4")!.includes(i)).toBe(false);
    const sels = rowsToSelectors(table, hidden);
    // whole (residue, altloc) groups compress to one selector each: Ligand A, EDO3 D
    expect(sels.map((s) => `${s.seqStart}${s.altId}${s.atomId ?? ""}`).sort()).toEqual(["501A", "502D"]);
  });
});

describe("7HHS_apo_bound.cif", () => {
  it("has three worlds and the apo state as the top world", async () => {
    const m = parseHetcif(await loadFixture("7HHS_apo_bound.cif"))!;
    expect(hetcifWorlds(m).map((w) => w.p)).toEqual([0.78, 0.13, 0.09]);
    expect(hetcifTopWorld(m)).toEqual({ ligand_site: "1" });
  });
});

describe("7a1x_flagship.cif", () => {
  it("reads the converted qFit model plus the four asserted tables", async () => {
    const file = await loadFixture("7a1x_flagship.cif");
    const m = parseHetcif(file)!;
    expect(m.variables.size).toBe(382);
    expect(m.tables.size).toBe(4);
    const multi = hetcifComponents(m).filter((c) => c.length > 1);
    expect(multi.map((c) => hetcifWorlds(m, c).length).sort((a, b) => a - b)).toEqual([7, 10, 18]);
  });

  it("derives the table children's marginals back to the qFit occupancies", async () => {
    const m = parseHetcif(await loadFixture("7a1x_flagship.cif"))!;
    const marg = hetcifMarginals(m);
    expect(marg.get("A102|A")).toBeCloseTo(0.759, 3);
    expect(marg.get("A102|B")).toBeCloseTo(0.169, 3);
    expect(marg.get("A102|C")).toBeCloseTo(0.072, 3);
    expect(marg.get("A304|present")).toBeCloseTo(0.845, 3);
    const top = hetcifTopWorld(m);
    expect(top["A97-102"]).toBe("A");
    expect(top["A102"]).toBe("A");
    expect(Object.keys(top)).toHaveLength(382);
  });

  it("is exposed through describeHeterogeneity and maps residues to variables", async () => {
    const file = await loadFixture("7a1x_flagship.cif");
    const d = describeHeterogeneity(file);
    expect(d.hetcif?.variables.size).toBe(382);
    const index = buildHetcifRowIndex(d.table!, d.hetcif!);
    expect(index.byResidue.get("A|102|")).toEqual(["A97-102", "A102"]);
    expect(index.byResidue.get("A|99|")).toEqual(["A97-102"]);
  });

  it("hides exactly the non-chosen conformers of a segment", async () => {
    const file = await loadFixture("7a1x_flagship.cif");
    const m = parseHetcif(file)!;
    const table = await loadTable("7a1x_flagship.cif");
    const t0 = performance.now();
    const index = buildHetcifRowIndex(table, m);
    const hidden = new Set(hiddenRowsForWorld(index, { "A97-102": "D" }));
    expect(performance.now() - t0).toBeLessThan(500);
    for (let i = 0; i < table.count; i++) {
      if (table.chain[i] !== "A" || table.seq[i] < 97 || table.seq[i] > 101) continue;
      if (!table.altId[i]) continue;
      expect(hidden.has(i)).toBe(table.altId[i] !== "D");
    }
  });
});
