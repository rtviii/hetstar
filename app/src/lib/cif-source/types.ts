// Minimal typed surface over Mol*'s parsed CifFile (ParsedCif.raw), exposing only the
// field-access methods the inspector uses. Mirrors molstar/lib/mol-io/reader/cif/data-model
// (CifFile / CifBlock / CifCategory / CifField) without coupling to its export paths.

export interface ToArrayParams {
  start?: number;
  /** Last row (exclusive). */
  end?: number;
}

export interface MolCifField {
  readonly isDefined: boolean;
  readonly rowCount: number;
  str(row: number): string;
  int(row: number): number;
  float(row: number): number;
  toStringArray(params?: ToArrayParams): ReadonlyArray<string>;
  toIntArray(params?: ToArrayParams): ReadonlyArray<number>;
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

/** Narrow ParsedCif.raw (typed as unknown) to the field-access surface above. */
export function asMolCifFile(raw: unknown): MolCifFile {
  return raw as MolCifFile;
}

/** Get a category from a block, or undefined. */
export function getCategory(
  file: MolCifFile,
  blockIndex: number,
  category: string,
): MolCifCategory | undefined {
  return file.blocks[blockIndex]?.categories[category];
}
