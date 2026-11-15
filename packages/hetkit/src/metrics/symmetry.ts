import type { AtomTable } from "../model/atoms";
import { isHeavy } from "../model/atoms";

// Symmetry copies of a model, for the metrics whose answer depends on what surrounds an
// atom in the crystal. This package has no space-group table and no Mol* dependency, so the
// caller generates the operators (every space-group operator combined with the lattice
// translations around the model, identity left out) and hands them in as Cartesian
// transforms; here they are only applied and cut to the neighbourhood of the model.

/** A Cartesian transform that maps the model onto one of its symmetry copies: 16 numbers in
 * ROW-major order,
 *
 *     [ r00 r01 r02 tx
 *       r10 r11 r12 ty
 *       r20 r21 r22 tz
 *       0   0   0   1 ]
 *
 * so that x' = r00 x + r01 y + r02 z + tx (indices 0..3), y' from indices 4..7, z' from
 * indices 8..11. Coordinates are in A, in the frame of atom_site.Cartn_x/y/z, which is also
 * the frame the map sampler is asked in. The last row must be 0 0 0 1. Mol* and gl-matrix
 * store a Mat4 column-major: convert with symmetryOperatorFromColumnMajor. */
export type SymmetryOperator = ArrayLike<number>;

/** From a column-major 4x4 (Mol*'s Mat4, gl-matrix: translation at indices 12, 13, 14). */
export function symmetryOperatorFromColumnMajor(matrix: ArrayLike<number>): number[] {
  const operator = new Array<number>(16);
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) operator[row * 4 + column] = matrix[column * 4 + row];
  }
  return operator;
}

/** how far beyond the model's bounding box a symmetry copy is kept, in A: a Q-score shell
 * point lies up to 2.0 A from its atom and is tested against atoms up to 1.8 A from it */
export const SYMMETRY_MATE_PADDING = 4;

export interface AltlocCodes {
  /** per atom row: index into `labels`; 0 for an atom with no altloc */
  codes: Uint16Array;
  /** labels[0] is "" (no altloc); the others in order of first appearance in the table */
  labels: string[];
}

/** The altloc label of every atom as a small integer, so labels compare without strings. */
export function altlocCodes(table: AtomTable): AltlocCodes {
  const labels = [""];
  const byLabel = new Map<string, number>([["", 0]]);
  const codes = new Uint16Array(table.count);
  for (let row = 0; row < table.count; row++) {
    const label = table.altId[row];
    let code = byLabel.get(label);
    if (code === undefined) {
      code = labels.length;
      labels.push(label);
      byLabel.set(label, code);
    }
    codes[row] = code;
  }
  return { codes, labels };
}

export interface SymmetryMates {
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** altloc label per copy, as an index into `altLabels` (0: no altloc); a copy keeps the
   * label of the atom it is a copy of, and the codes are those of altlocCodes(table) */
  alt: Uint16Array;
  altLabels: string[];
  /** per copy: the atom row of the table it is a copy of */
  row: Int32Array;
  /** per copy: index of the operator that made it */
  operator: Int32Array;
}

/** The symmetry copies of a model's non-hydrogen atoms that fall within the bounding box of
 * those atoms padded by `padding` (default SYMMETRY_MATE_PADDING). An identity operator is
 * harmless (its copies coincide with the atoms) but wasteful. */
export function symmetryMates(
  table: AtomTable,
  operators: readonly SymmetryOperator[],
  options: { padding?: number } = {},
): SymmetryMates {
  const padding = options.padding ?? SYMMETRY_MATE_PADDING;
  const { codes, labels } = altlocCodes(table);

  const heavyRows: number[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let row = 0; row < table.count; row++) {
    if (!isHeavy(table, row)) continue;
    heavyRows.push(row);
    const x = table.x[row], y = table.y[row], z = table.z[row];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  minX -= padding;
  minY -= padding;
  minZ -= padding;
  maxX += padding;
  maxY += padding;
  maxZ += padding;

  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const rows: number[] = [];
  const made: number[] = [];
  operators.forEach((m, index) => {
    if (m.length !== 16 || m[12] !== 0 || m[13] !== 0 || m[14] !== 0 || m[15] !== 1) {
      throw new Error(`symmetry operator ${index} is not a row-major 4x4 transform with last row 0 0 0 1`);
    }
    for (const row of heavyRows) {
      const x = table.x[row], y = table.y[row], z = table.z[row];
      const mx = m[0] * x + m[1] * y + m[2] * z + m[3];
      if (mx < minX || mx > maxX) continue;
      const my = m[4] * x + m[5] * y + m[6] * z + m[7];
      if (my < minY || my > maxY) continue;
      const mz = m[8] * x + m[9] * y + m[10] * z + m[11];
      if (mz < minZ || mz > maxZ) continue;
      xs.push(mx);
      ys.push(my);
      zs.push(mz);
      rows.push(row);
      made.push(index);
    }
  });

  const alt = new Uint16Array(rows.length);
  for (let i = 0; i < rows.length; i++) alt[i] = codes[rows[i]];
  return {
    count: rows.length,
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    z: Float64Array.from(zs),
    alt,
    altLabels: labels,
    row: Int32Array.from(rows),
    operator: Int32Array.from(made),
  };
}
