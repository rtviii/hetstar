// Minimal typed surface over Mol*'s parsed CifFile, exposing only the field-access
// methods this package uses. Mirrors molstar/lib/mol-io/reader/cif/data-model
// (CifFile / CifBlock / CifCategory / CifField) without coupling to its export paths.

export interface MolCifField {
  readonly isDefined: boolean;
  readonly rowCount: number;
  str(row: number): string;
  int(row: number): number;
  float(row: number): number;
}

export interface MolCifCategory {
  readonly name: string;
  readonly rowCount: number;
  readonly fieldNames: ReadonlyArray<string>;
  getField(name: string): MolCifField | undefined;
}

export interface MolCifBlock {
  readonly header: string;
  readonly categoryNames: ReadonlyArray<string>;
  readonly categories: Record<string, MolCifCategory>;
}

export interface MolCifFile {
  readonly blocks: ReadonlyArray<MolCifBlock>;
}

/** Narrow a parsed CIF (typed as unknown by callers) to the field-access surface above. */
export function asMolCifFile(raw: unknown): MolCifFile {
  return raw as MolCifFile;
}

/** '' for missing / '.' / '?', trimmed otherwise. */
export function normValue(s: string | undefined | null): string {
  const v = (s ?? "").trim();
  return v === "" || v === "." || v === "?" ? "" : v;
}
