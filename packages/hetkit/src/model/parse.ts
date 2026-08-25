import { CIF } from "molstar/lib/mol-io/reader/cif";
import type { MolCifFile } from "./cif";
import { asMolCifFile } from "./cif";

// Parse mmCIF text into the narrow CifFile surface the rest of the package reads.
// Mol*'s parser handles both RCSB column-0 style and the gemmi/Phenix indented style
// that qFit output uses. Runs headless (node) as well as in the browser.
export async function parseCifText(data: string): Promise<MolCifFile> {
  const parsed = await CIF.parseText(data).run();
  if (parsed.isError) throw new Error(`CIF parse error: ${parsed.message}`);
  return asMolCifFile(parsed.result);
}
