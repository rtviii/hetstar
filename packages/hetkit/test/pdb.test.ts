import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildAtomTable, parseCifText, pdbToCifText, summarizeAltlocs, summarizeEnsemble } from "../src/model";

// 2ws1_020.pdb: a phenix.refine re-refined model as Dynamic PDB stores it (two chains,
// altlocs, two ligands, waters). Converting it must not change a single atom.
const PDB = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "2ws1_020.pdb"), "utf8");

const atomLines = (text: string) => text.split("\n").filter((l) => l.startsWith("ATOM  ") || l.startsWith("HETATM"));

describe("pdbToCifText", () => {
  it("keeps every atom with its author chain, altloc, occupancy and B", async () => {
    const lines = atomLines(PDB);
    const table = buildAtomTable(await parseCifText(await pdbToCifText(PDB)));
    expect(table).not.toBeNull();
    expect(table!.count).toBe(lines.length);
    lines.forEach((l, i) => {
      expect(table!.chain[i]).toBe(l.slice(21, 22).trim());
      expect(table!.seq[i]).toBe(parseInt(l.slice(22, 26), 10));
      expect(table!.atomName[i]).toBe(l.slice(12, 16).trim());
      expect(table!.altId[i]).toBe(l.slice(16, 17).trim());
      expect(table!.occupancy[i]).toBeCloseTo(parseFloat(l.slice(54, 60)), 2);
      expect(table!.bIso[i]).toBeCloseTo(parseFloat(l.slice(60, 66)), 2);
      expect(table!.element[i]).toBe(l.slice(76, 78).trim().toUpperCase());
    });
    const altlocs = summarizeAltlocs(table!);
    expect(altlocs?.residues.length).toBeGreaterThan(0);
    expect(altlocs?.occupancySumOk).toBe(true);
  });

  it("gives every label_asym_id a single author chain", async () => {
    const at = (await parseCifText(await pdbToCifText(PDB))).blocks[0].categories["atom_site"];
    const label = at.getField("label_asym_id")!;
    const auth = at.getField("auth_asym_id")!;
    const authOf = new Map<string, Set<string>>();
    for (let r = 0; r < at.rowCount; r++) {
      const set = authOf.get(label.str(r)) ?? new Set<string>();
      set.add(auth.str(r));
      authOf.set(label.str(r), set);
    }
    expect(authOf.size).toBeGreaterThan(1);
    for (const chains of authOf.values()) expect(chains.size).toBe(1);
    // no SEQRES in the file: the column is left for Mol* to number, never written as '.'
    expect(at.getField("label_seq_id")).toBeUndefined();
  });

  it("turns MODEL records into ascending pdbx_PDB_model_num", async () => {
    const chainA = atomLines(PDB).filter((l) => l.slice(21, 22) === "A" && l.startsWith("ATOM"));
    const ensemble = [1, 2, 3].map((n) => [`MODEL     ${String(n).padStart(4)}`, ...chainA, "ENDMDL"].join("\n")).join("\n") + "\nEND\n";
    const file = await parseCifText(await pdbToCifText(ensemble));
    expect(summarizeEnsemble(file)).toEqual({ modelCount: 3, modelNums: [1, 2, 3] });
    expect(buildAtomTable(file, { modelNum: 2 })!.count).toBe(chainA.length);
  });

  it("decodes hybrid-36 residue numbers above 9999", async () => {
    const water = atomLines(PDB).find((l) => l.slice(17, 20) === "HOH")!;
    const numbered = ["9999", "A000", "A001"].map((n) => water.slice(0, 22) + n + water.slice(26)).join("\n");
    const table = buildAtomTable(await parseCifText(await pdbToCifText(numbered + "\nEND\n")));
    expect(Array.from(table!.seq)).toEqual([9999, 10000, 10001]);
  });
});
