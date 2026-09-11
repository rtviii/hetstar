import type { MolCifBlock, MolCifCategory, MolCifFile } from "./cif";
import { normValue } from "./cif";

// Entry-level description read from the header categories of a deposited mmCIF: what a
// landing page states about the experiment (title, method, resolution, space group,
// deposition date, growth conditions) and about each entity (description, organism,
// UniProt reference). Every field is nullable — qFit/Phenix outputs carry none of these
// categories and simply yield an empty description.

export interface EntryEntity {
  id: string;
  /** _entity.pdbx_description */
  description: string | null;
  /** _entity.type (polymer / non-polymer / water) */
  type: string | null;
  /** scientific name from entity_src_gen (engineered) or entity_src_nat (natural) */
  organism: string | null;
  /** UniProt accession from _struct_ref (db_name UNP) */
  uniprot: string | null;
}

export interface EntryDescription {
  title: string | null;
  /** _exptl.method, e.g. "X-RAY DIFFRACTION" */
  method: string | null;
  /** _symmetry.space_group_name_H-M */
  spaceGroup: string | null;
  /** angstroms; _refine.ls_d_res_high, falling back to _reflns.d_resolution_high */
  resolution: number | null;
  rWork: number | null;
  rFree: number | null;
  /** _pdbx_database_status.recvd_initial_deposition_date, as written (ISO date) */
  depositedDate: string | null;
  authorCount: number;
  firstAuthor: string | null;
  /** crystallization pH / temperature (kelvin) from _exptl_crystal_grow */
  ph: number | null;
  temperatureK: number | null;
  entities: EntryEntity[];
}

function text(cat: MolCifCategory | undefined, field: string, row = 0): string | null {
  const f = cat?.getField(field);
  if (!f || !cat || row >= cat.rowCount) return null;
  return normValue(f.str(row)) || null;
}

// via the string form: Mol*'s float() reads missing/'?' as 0, which is a real value here
function num(cat: MolCifCategory | undefined, field: string, row = 0): number | null {
  const s = text(cat, field, row);
  if (s === null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function perEntity(block: MolCifBlock, category: string, idField: string, valueField: string): Map<string, string> {
  const out = new Map<string, string>();
  const cat = block.categories[category];
  const fId = cat?.getField(idField);
  const fVal = cat?.getField(valueField);
  if (!cat || !fId || !fVal) return out;
  for (let r = 0; r < cat.rowCount; r++) {
    const id = normValue(fId.str(r));
    const val = normValue(fVal.str(r));
    if (id && val && !out.has(id)) out.set(id, val);
  }
  return out;
}

export function describeEntry(file: MolCifFile, blockIndex = 0): EntryDescription {
  const block = file.blocks[blockIndex];
  const empty: EntryDescription = {
    title: null, method: null, spaceGroup: null, resolution: null, rWork: null, rFree: null,
    depositedDate: null, authorCount: 0, firstAuthor: null, ph: null, temperatureK: null, entities: [],
  };
  if (!block) return empty;
  const cats = block.categories;

  const authors = cats["audit_author"];
  const entities: EntryEntity[] = [];
  const entity = cats["entity"];
  if (entity) {
    const fId = entity.getField("id");
    const descOf = perEntity(block, "entity", "id", "pdbx_description");
    const typeOf = perEntity(block, "entity", "id", "type");
    const srcGen = perEntity(block, "entity_src_gen", "entity_id", "pdbx_gene_src_scientific_name");
    const srcNat = perEntity(block, "entity_src_nat", "entity_id", "pdbx_organism_scientific");
    // UNP accessions only; other reference databases are not this record's business
    const unp = new Map<string, string>();
    const sref = cats["struct_ref"];
    const fDb = sref?.getField("db_name");
    const fEnt = sref?.getField("entity_id");
    const fAcc = sref?.getField("pdbx_db_accession");
    if (sref && fDb && fEnt && fAcc) {
      for (let r = 0; r < sref.rowCount; r++) {
        if (normValue(fDb.str(r)).toUpperCase() !== "UNP") continue;
        const id = normValue(fEnt.str(r));
        const acc = normValue(fAcc.str(r));
        if (id && acc && !unp.has(id)) unp.set(id, acc);
      }
    }
    if (fId) {
      const seen = new Set<string>();
      for (let r = 0; r < entity.rowCount; r++) {
        const id = normValue(fId.str(r));
        if (!id || seen.has(id)) continue;
        seen.add(id);
        entities.push({
          id,
          description: descOf.get(id) ?? null,
          type: typeOf.get(id) ?? null,
          organism: srcGen.get(id) ?? srcNat.get(id) ?? null,
          uniprot: unp.get(id) ?? null,
        });
      }
    }
  }

  return {
    title: text(cats["struct"], "title"),
    method: text(cats["exptl"], "method"),
    spaceGroup: text(cats["symmetry"], "space_group_name_H-M"),
    resolution: num(cats["refine"], "ls_d_res_high") ?? num(cats["reflns"], "d_resolution_high"),
    rWork: num(cats["refine"], "ls_R_factor_R_work"),
    rFree: num(cats["refine"], "ls_R_factor_R_free"),
    depositedDate: text(cats["pdbx_database_status"], "recvd_initial_deposition_date"),
    authorCount: authors?.rowCount ?? 0,
    firstAuthor: text(authors, "name"),
    ph: num(cats["exptl_crystal_grow"], "pH"),
    temperatureK: num(cats["exptl_crystal_grow"], "temp"),
    entities,
  };
}
