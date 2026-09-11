import { describe, expect, it } from "vitest";

import { buildSequenceModel, describeEntry } from "../src/model";
import { loadFixture, loadTable } from "./load";

describe("describeEntry", () => {
  it("reads the header categories of a deposited mmCIF", async () => {
    const d = describeEntry(await loadFixture("7A1X.cif"));
    expect(d.title).toBe("KRASG12C GDP form in complex with Cpd1");
    expect(d.method).toBe("X-RAY DIFFRACTION");
    expect(d.spaceGroup).toBe("P 21 21 21");
    expect(d.resolution).toBeCloseTo(1.32, 5);
    expect(d.rWork).toBeCloseTo(0.148, 5);
    expect(d.rFree).toBeCloseTo(0.1739, 5);
    expect(d.depositedDate).toBe("2020-08-14");
    expect(d.authorCount).toBeGreaterThan(0);
    expect(d.firstAuthor).toBeTruthy();
    expect(d.ph).toBeCloseTo(8.5, 5);
    expect(d.temperatureK).toBeCloseTo(277, 5);
    const protein = d.entities.find((e) => e.type === "polymer");
    expect(protein?.organism).toBe("Homo sapiens");
    expect(protein?.uniprot).toBe("P01116");
    expect(protein?.description).toBeTruthy();
  });

  it("reads what a phenix/qFit header carries and leaves the deposition fields null", async () => {
    const d = describeEntry(await loadFixture("7a1x_qFit_010.cif"));
    // phenix writes cell/symmetry/refine/exptl; it does not write struct, entity or status
    expect(d.spaceGroup).toBe("P 21 21 21");
    expect(d.resolution).toBeCloseTo(1.32, 5);
    expect(d.title).toBeNull();
    expect(d.depositedDate).toBeNull();
    expect(d.entities).toEqual([]);
  });
});

describe("entityDescription on the sequence chains", () => {
  it("joins _entity.pdbx_description through entity_id", async () => {
    const file = await loadFixture("7A1X.cif");
    const table = await loadTable("7a1x_qFit_010.cif");
    const model = buildSequenceModel(file, table);
    const chain = model.chains[0];
    expect(chain.entityDescription).toBeTruthy();
  });

  it("stays null when the source file has no _entity", async () => {
    const file = await loadFixture("7a1x_qFit_010.cif");
    const table = await loadTable("7a1x_qFit_010.cif");
    const model = buildSequenceModel(file, table);
    expect(model.chains[0].entityDescription).toBeNull();
  });
});
