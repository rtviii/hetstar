import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAtomTable, parseCifText, type AtomTable, type MolCifFile } from "../src/model";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const fileCache = new Map<string, Promise<MolCifFile>>();

export function loadFixture(name: string): Promise<MolCifFile> {
  let p = fileCache.get(name);
  if (!p) {
    p = parseCifText(readFileSync(join(FIXTURES, name), "utf8"));
    fileCache.set(name, p);
  }
  return p;
}

export async function loadTable(name: string): Promise<AtomTable> {
  const table = buildAtomTable(await loadFixture(name));
  if (!table) throw new Error(`no atom_site in fixture ${name}`);
  return table;
}
