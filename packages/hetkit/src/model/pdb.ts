import type { CifCategory } from "molstar/lib/mol-io/reader/cif/data-model";
import { parsePDB } from "molstar/lib/mol-io/reader/pdb/parser";
import { CifWriter } from "molstar/lib/mol-io/writer/cif";
import { pdbToMmCif } from "molstar/lib/mol-model-formats/structure/pdb/to-cif";

// PDB text to mmCIF text through Mol*'s own converter, the one its PDB provider runs, so
// label_asym_id / label_entity_id come out as Mol* would build them from the PDB itself.
// Everything downstream reads CIF text and never learns the source was PDB.
export async function pdbToCifText(data: string, id = "model"): Promise<string> {
  const parsed = await parsePDB(data, id).run();
  if (parsed.isError) throw new Error(`PDB parse error: ${parsed.message}`);
  const frame = await pdbToMmCif(parsed.result);
  const encoder = CifWriter.createEncoder();
  encoder.startDataBlock(frame.header);
  for (const name of frame.categoryNames) encoder.writeCategory(writableCategory(frame.categories[name]));
  return encoder.getData() as string;
}

function writableCategory(category: CifCategory): CifWriter.Category {
  const fields: CifWriter.Field<number>[] = [];
  for (const fieldName of category.fieldNames) {
    // Mol* suffixes a name repeated within a residue ("N_1"), altloc copies included, which
    // would split every altloc atom from its partner; the author name is the right label here
    const source = category.name === "atom_site" && fieldName === "label_atom_id" ? "auth_atom_id" : fieldName;
    const field = category.getField(source)!;
    // an undefined field (label_seq_id without SEQRES) is left out, not written as '.':
    // Mol* numbers a missing column 1..n per chain, but reads a column of '.' as all zeros
    if (!field.isDefined) continue;
    const value =
      category.name === "atom_site" && fieldName === "auth_seq_id"
        ? (row: number) => residueNumber(field.str(row))
        : (row: number) => field.str(row);
    fields.push(CifWriter.Field.str<number>(fieldName, value, { valueKind: (row) => field.valueKind(row) }));
  }
  return {
    name: category.name,
    instance: () => ({ fields, source: [{ rowCount: category.rowCount }] }),
  };
}

// phenix writes residue numbers above 9999 in hybrid-36 ("A000" is 10000, "a000" follows "ZZZZ");
// Mol* reads those as 0, which would fold every such residue into one
function residueNumber(token: string): string {
  const field = token.trim();
  if (!/^[A-Za-z]/.test(field)) return field;
  const value = parseInt(field, 36) - parseInt("A000", 36) + 10000;
  return String(field[0] === field[0].toUpperCase() ? value : value + 26 * 36 ** 3);
}
