import { Spacegroup, SpacegroupCell } from "molstar/lib/mol-math/geometry";
import { Mat4, Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { symmetryOperatorFromColumnMajor, type SymmetryOperator } from "@dynamic-pdb/hetkit/metrics";
import { describeEntry, isHeavy, type AtomTable, type MolCifFile } from "@dynamic-pdb/hetkit/model";

// The crystal of an entry, for the metrics that look at an atom's surroundings (Q-score):
// the transforms that carry a model onto the copies of itself that touch it. hetkit has no
// space-group table, so the operators are built here from Mol*'s and handed to it as plain
// matrices. The models of an entry share one crystal (the one the map is from), so it is
// read from the first file of the entry that states it. The Cartesian frame is taken to be
// the standard one of the cell (the rare file with a non-standard frame would get wrong
// copies).

/** how far beyond touching a copy may sit and still be handed over, in angstrom (hetkit cuts to 4) */
const MARGIN = 8;

const crystals = new WeakMap<MolCifFile, Spacegroup | null>();

/** the space group and cell a file states; null when it states none or Mol* does not know the group */
export function crystalOf(file: MolCifFile): Spacegroup | null {
  const known = crystals.get(file);
  if (known !== undefined) return known;
  const { cell, spaceGroup } = describeEntry(file);
  let crystal: Spacegroup | null = null;
  if (cell && spaceGroup) {
    const radians = Math.PI / 180;
    const spacegroupCell = SpacegroupCell.create(
      spaceGroup,
      Vec3.create(cell.a, cell.b, cell.c),
      Vec3.create(cell.alpha * radians, cell.beta * radians, cell.gamma * radians),
    );
    if (!SpacegroupCell.isZero(spacegroupCell)) crystal = Spacegroup.create(spacegroupCell);
  }
  crystals.set(file, crystal);
  return crystal;
}

const operatorCache = new WeakMap<AtomTable, { crystal: Spacegroup; operators: SymmetryOperator[] }>();

/**
 * The transforms onto every symmetry copy of the model that can come within reach of it:
 * each operator of the space group with each lattice translation, kept when the copy's
 * bounding sphere comes within MARGIN of the model's own. The identity is left out. Computed
 * once per table and crystal, so the list keeps its identity (the metric cache keys on it).
 */
export function symmetryOperatorsAround(crystal: Spacegroup, table: AtomTable): SymmetryOperator[] {
  const cached = operatorCache.get(table);
  if (cached && cached.crystal === crystal) return cached.operators;

  const centre = Vec3.zero();
  let heavy = 0;
  for (let row = 0; row < table.count; row++) {
    if (!isHeavy(table, row)) continue;
    centre[0] += table.x[row];
    centre[1] += table.y[row];
    centre[2] += table.z[row];
    heavy++;
  }
  const operators: SymmetryOperator[] = [];
  if (heavy > 0) {
    Vec3.scale(centre, centre, 1 / heavy);
    let radiusSquared = 0;
    for (let row = 0; row < table.count; row++) {
      if (!isHeavy(table, row)) continue;
      const dx = table.x[row] - centre[0], dy = table.y[row] - centre[1], dz = table.z[row] - centre[2];
      radiusSquared = Math.max(radiusSquared, dx * dx + dy * dy + dz * dz);
    }
    const reach = 2 * Math.sqrt(radiusSquared) + MARGIN;
    const { size } = crystal.cell;
    // an upper bound on how many cells away a copy within reach can be (exact for a
    // rectangular cell, generous enough for the skewed ones with the extra cell)
    const span = Math.ceil(reach / Math.min(size[0], size[1], size[2])) + 1;
    const fractional = Vec3.transformMat4(Vec3(), centre, crystal.cell.toFractional);
    const moved = Vec3();
    const copy = Vec3();
    const matrix = Mat4();
    for (let op = 0; op < crystal.operators.length; op++) {
      // the lattice translation that brings this operator's copy nearest, then its neighbours
      Vec3.transformMat4(moved, fractional, crystal.operators[op]);
      const i0 = Math.round(fractional[0] - moved[0]);
      const j0 = Math.round(fractional[1] - moved[1]);
      const k0 = Math.round(fractional[2] - moved[2]);
      for (let i = i0 - span; i <= i0 + span; i++) {
        for (let j = j0 - span; j <= j0 + span; j++) {
          for (let k = k0 - span; k <= k0 + span; k++) {
            Spacegroup.setOperatorMatrix(crystal, op, i, j, k, matrix);
            if (Mat4.isIdentity(matrix)) continue;
            Vec3.transformMat4(copy, centre, matrix);
            if (Vec3.distance(copy, centre) > reach) continue;
            operators.push(symmetryOperatorFromColumnMajor(matrix));
          }
        }
      }
    }
  }
  operatorCache.set(table, { crystal, operators });
  return operators;
}
