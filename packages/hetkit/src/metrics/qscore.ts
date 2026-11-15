import type { AtomTable, ResidueEntry } from "../model/atoms";
import { isHeavy } from "../model/atoms";
import { residueKey } from "../model/keys";
import { isPolymerComp } from "../model/sequence";
import type { MapSampler } from "./map";
import { altlocCodes, symmetryMates, type SymmetryOperator } from "./symmetry";
import type { Track } from "./tracks";
import { makeTrack } from "./tracks";

// Q-score (Pintilie et al. 2020) as MapQ computes it on its default path (sigma 0.6): how
// well the map around an atom follows a Gaussian of fixed width centred on the atom. The map
// is sampled at the atom centre (counted as 8 points) and on shells of radius 0.1 to 2.0 A,
// at points of a fixed spiral that no atom of the neighbour set comes nearer than 0.9 of the
// shell radius; Q is the Pearson correlation of those samples with exp(-0.5 (r / 0.6)^2).
//
// Where this departs from MapQ, on purpose:
//   - the neighbour set also holds the model's symmetry copies when the caller supplies the
//     operators (MapQ has none: its models are cryo-EM);
//   - an atom with an altloc label is shadowed only by atoms with the same label or with
//     none (in MapQ the conformers of a residue shadow each other);
//   - the residue value is the occupancy-weighted mean over its atoms (MapQ: plain mean).
// MapQ's reference is A * gaussian + B with A and B from the map's statistics; a Pearson
// correlation does not see them, so they default to 1 and 0 here.

export const QSCORE_SIGMA = 0.6;
const SHELL_STEP = 0.1;
const SHELL_COUNT = 20;
/** points a shell needs to contribute, the size of the first spiral, and the weight of the centre */
const SHELL_POINTS = 8;
const ATTEMPTS = 50;
const NEIGHBOUR_FACTOR = 0.9;
/** an atom is scored when samples at this many distinct radii (the centre is one) have data */
const MIN_RADII = 3;
const CELL_EDGE = 2;
const MAX_CELLS = 4_000_000;
/** no atom farther than this from a scored atom can shadow one of its shell points */
const REACH = (1 + NEIGHBOUR_FACTOR) * SHELL_STEP * SHELL_COUNT;
const MAX_ATOM_POINTS = SHELL_POINTS + SHELL_COUNT * (SHELL_POINTS + 2 * (ATTEMPTS - 1));

/** Unit vectors of MapQ's SpherePts spiral for `count` points, as x, y, z triples: the first
 * is the -z pole, the last the +z pole. */
export function spiralDirections(count: number): Float64Array {
  const directions = new Float64Array(3 * count);
  let theta = 0;
  for (let k = 1; k <= count; k++) {
    const h = -1 + (2 * (k - 1)) / (count - 1);
    const phi = Math.acos(h);
    theta = k === 1 || k === count ? 0 : (theta + 3.6 / Math.sqrt(count * (1 - h * h))) % (2 * Math.PI);
    directions[3 * (k - 1)] = Math.sin(phi) * Math.cos(theta);
    directions[3 * (k - 1) + 1] = Math.sin(phi) * Math.sin(theta);
    directions[3 * (k - 1) + 2] = Math.cos(phi);
  }
  return directions;
}

/** MapQ's SpherePts(centre, radius, count): the candidate points of a shell, as x, y, z triples. */
export function spherePoints(x: number, y: number, z: number, radius: number, count: number): Float64Array {
  const points = spiralDirections(count);
  for (let k = 0; k < count; k++) {
    points[3 * k] = x + radius * points[3 * k];
    points[3 * k + 1] = y + radius * points[3 * k + 1];
    points[3 * k + 2] = z + radius * points[3 * k + 2];
  }
  return points;
}

// the spirals of the 50 attempts: 8, 10, ..., 106 points
const SPIRALS: Float64Array[] = [];
for (let attempt = 0; attempt < ATTEMPTS; attempt++) SPIRALS.push(spiralDirections(SHELL_POINTS + 2 * attempt));

const SHELL_GAUSSIAN = new Float64Array(SHELL_COUNT + 1);
for (let shell = 0; shell <= SHELL_COUNT; shell++) {
  SHELL_GAUSSIAN[shell] = Math.exp(-0.5 * ((SHELL_STEP * shell) / QSCORE_SIGMA) ** 2);
}

export interface QScoreOptions {
  /** Cartesian transforms onto the model's symmetry copies (see SymmetryOperator), identity
   * left out. Absent or empty: the model is scored without symmetry mates. */
  symmetryOperators?: readonly SymmetryOperator[] | null;
  /** residues that get a value in the track; every atom still shadows. Default: polymer residues */
  include?: (residue: ResidueEntry) => boolean;
  /** A and B of MapQ's reference A * gaussian + B. Q does not depend on them (A positive);
   * they exist so that this can be checked. Defaults 1 and 0. */
  referenceScale?: number;
  referenceOffset?: number;
  /** metricId of the returned track; default "qscore" */
  metricId?: string;
}

export interface AtomQScores {
  /** Q per atom row of the table; NaN for hydrogens and for atoms that cannot be scored
   * (data at fewer than 3 radii, or a flat map around the atom) */
  values: Float64Array;
  /** symmetry copies that entered the neighbour set */
  mateCount: number;
}

export interface QScoreResult {
  /** per residue of the first state, same keys as rscc-computed: the mean over the states of
   * the residue's occupancy-weighted mean atom Q; NaN for residues `include` leaves out */
  track: Track;
  /** per state: Q per atom row of that state's table (ligands, ions and waters included) */
  atoms: Float64Array[];
  /** false when no symmetry operators were supplied: atoms at crystal contacts were then
   * scored as if the density of the neighbouring copy were their own surroundings */
  symmetryMates: boolean;
  /** per state: symmetry copies that entered the neighbour set */
  mateCounts: number[];
}

/** Q-score of a model against a map. `states` is the model as its coordinate frames, as in
 * realSpaceCorrelation: one table, or one per ensemble member. Each state is scored alone
 * (its own atoms and its own symmetry copies as neighbours); altloc conformers are not
 * separate states, the altloc rule above covers them. */
export function qScore(states: readonly AtomTable[], sample: MapSampler, options: QScoreOptions = {}): QScoreResult {
  const include = options.include ?? ((residue: ResidueEntry) => isPolymerComp(residue.compId));
  const scored = states.map((table) => qScoreAtoms(table, sample, options));
  const residues = states[0].residues;
  const sums = new Float64Array(residues.length);
  const counts = new Int32Array(residues.length);
  states.forEach((table, s) => {
    const atomValues = scored[s].values;
    for (const residue of table.residues) {
      const index = states[0].residueIndex.get(residueKey(residue.ref));
      if (index === undefined || !include(residues[index])) continue;
      let weight = 0;
      let sum = 0;
      for (const row of residue.rows) {
        const q = atomValues[row];
        if (Number.isNaN(q)) continue;
        weight += table.occupancy[row];
        sum += table.occupancy[row] * q;
      }
      if (!(weight > 0)) continue;
      sums[index] += sum / weight;
      counts[index]++;
    }
  });
  const values = new Float32Array(residues.length);
  for (let i = 0; i < residues.length; i++) values[i] = counts[i] > 0 ? sums[i] / counts[i] : NaN;
  return {
    track: makeTrack(options.metricId ?? "qscore", "residue", residues.map((residue) => residue.ref), values),
    atoms: scored.map((state) => state.values),
    symmetryMates: !!options.symmetryOperators?.length,
    mateCounts: scored.map((state) => state.mateCount),
  };
}

/** Q of every non-hydrogen atom of one table against the map; the neighbour set is the
 * table's non-hydrogen atoms and, with operators, their symmetry copies. */
export function qScoreAtoms(
  table: AtomTable,
  sample: MapSampler,
  options: Pick<QScoreOptions, "symmetryOperators" | "referenceScale" | "referenceOffset"> = {},
): AtomQScores {
  const referenceScale = options.referenceScale ?? 1;
  const referenceOffset = options.referenceOffset ?? 0;
  const values = new Float64Array(table.count).fill(NaN);

  // --- the neighbour set: the table's heavy atoms, then the symmetry copies ---
  const { codes } = altlocCodes(table);
  const heavyRows: number[] = [];
  for (let row = 0; row < table.count; row++) if (isHeavy(table, row)) heavyRows.push(row);
  const mates = options.symmetryOperators?.length ? symmetryMates(table, options.symmetryOperators) : null;
  const mateCount = mates ? mates.count : 0;
  const total = heavyRows.length + mateCount;
  if (heavyRows.length === 0) return { values, mateCount };

  const setX = new Float64Array(total);
  const setY = new Float64Array(total);
  const setZ = new Float64Array(total);
  const setAlt = new Uint16Array(total);
  heavyRows.forEach((row, i) => {
    setX[i] = table.x[row];
    setY[i] = table.y[row];
    setZ[i] = table.z[row];
    setAlt[i] = codes[row];
  });
  if (mates) {
    setX.set(mates.x, heavyRows.length);
    setY.set(mates.y, heavyRows.length);
    setZ.set(mates.z, heavyRows.length);
    setAlt.set(mates.alt, heavyRows.length);
  }

  // --- a uniform cell grid over it: the points sorted by cell, each cell a run ---
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < total; i++) {
    if (setX[i] < minX) minX = setX[i];
    if (setY[i] < minY) minY = setY[i];
    if (setZ[i] < minZ) minZ = setZ[i];
    if (setX[i] > maxX) maxX = setX[i];
    if (setY[i] > maxY) maxY = setY[i];
    if (setZ[i] > maxZ) maxZ = setZ[i];
  }
  const volume = (maxX - minX + CELL_EDGE) * (maxY - minY + CELL_EDGE) * (maxZ - minZ + CELL_EDGE);
  const edge = Math.max(CELL_EDGE, Math.cbrt(volume / MAX_CELLS));
  const nx = Math.floor((maxX - minX) / edge) + 1;
  const ny = Math.floor((maxY - minY) / edge) + 1;
  const nz = Math.floor((maxZ - minZ) / edge) + 1;
  const cellOf = new Int32Array(total);
  const cellStart = new Int32Array(nx * ny * nz + 1);
  for (let i = 0; i < total; i++) {
    const cell =
      (Math.floor((setZ[i] - minZ) / edge) * ny + Math.floor((setY[i] - minY) / edge)) * nx +
      Math.floor((setX[i] - minX) / edge);
    cellOf[i] = cell;
    cellStart[cell + 1]++;
  }
  for (let cell = 0; cell < nx * ny * nz; cell++) cellStart[cell + 1] += cellStart[cell];
  const filled = cellStart.slice(0, nx * ny * nz);
  const gridX = new Float64Array(total);
  const gridY = new Float64Array(total);
  const gridZ = new Float64Array(total);
  const gridAlt = new Uint16Array(total);
  for (let i = 0; i < total; i++) {
    const at = filled[cellOf[i]]++;
    gridX[at] = setX[i];
    gridY[at] = setY[i];
    gridZ[at] = setZ[i];
    gridAlt[at] = setAlt[i];
  }

  // --- per atom: the neighbours that can shadow it, relative to it and nearest first; then
  // the shells, each candidate tested against the neighbours near enough for that radius ---
  let capacity = 64;
  let localX = new Float64Array(capacity);
  let localY = new Float64Array(capacity);
  let localZ = new Float64Array(capacity);
  let localSquared = new Float64Array(capacity);
  const keptIndex = new Int32Array(SHELL_POINTS + 2 * (ATTEMPTS - 1));
  const observed = new Float64Array(MAX_ATOM_POINTS);
  const reference = new Float64Array(MAX_ATOM_POINTS);
  const reachSquared = REACH * REACH;

  for (const row of heavyRows) {
    const cx = table.x[row], cy = table.y[row], cz = table.z[row];
    const code = codes[row];

    let local = 0;
    const i0 = Math.max(0, Math.floor((cx - REACH - minX) / edge));
    const i1 = Math.min(nx - 1, Math.floor((cx + REACH - minX) / edge));
    const j0 = Math.max(0, Math.floor((cy - REACH - minY) / edge));
    const j1 = Math.min(ny - 1, Math.floor((cy + REACH - minY) / edge));
    const k0 = Math.max(0, Math.floor((cz - REACH - minZ) / edge));
    const k1 = Math.min(nz - 1, Math.floor((cz + REACH - minZ) / edge));
    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        const base = (k * ny + j) * nx;
        const end = cellStart[base + i1 + 1];
        for (let p = cellStart[base + i0]; p < end; p++) {
          // the altloc rule: a labelled atom is shadowed by its own label and by unlabelled atoms
          const other = gridAlt[p];
          if (code !== 0 && other !== 0 && other !== code) continue;
          const dx = gridX[p] - cx, dy = gridY[p] - cy, dz = gridZ[p] - cz;
          const squared = dx * dx + dy * dy + dz * dz;
          // the atom itself and anything exactly on it sit at the shell radius from every candidate
          if (squared === 0 || squared >= reachSquared) continue;
          if (local === capacity) {
            capacity *= 2;
            const grow = (old: Float64Array) => {
              const grown = new Float64Array(capacity);
              grown.set(old);
              return grown;
            };
            localX = grow(localX);
            localY = grow(localY);
            localZ = grow(localZ);
            localSquared = grow(localSquared);
          }
          let q = local;
          while (q > 0 && localSquared[q - 1] > squared) {
            localX[q] = localX[q - 1];
            localY[q] = localY[q - 1];
            localZ[q] = localZ[q - 1];
            localSquared[q] = localSquared[q - 1];
            q--;
          }
          localX[q] = dx;
          localY[q] = dy;
          localZ[q] = dz;
          localSquared[q] = squared;
          local++;
        }
      }
    }

    let points = 0;
    let radii = 0;
    const centre = sample(cx, cy, cz);
    if (!Number.isNaN(centre)) {
      for (let copy = 0; copy < SHELL_POINTS; copy++) {
        observed[points] = centre;
        reference[points] = referenceScale * SHELL_GAUSSIAN[0] + referenceOffset;
        points++;
      }
      radii++;
    }

    let inRange = 0;
    for (let shell = 1; shell <= SHELL_COUNT; shell++) {
      const radius = SHELL_STEP * shell;
      const limit = NEIGHBOUR_FACTOR * radius;
      const limitSquared = limit * limit;
      const rangeSquared = (radius + limit) * (radius + limit);
      while (inRange < local && localSquared[inRange] < rangeSquared) inRange++;

      let directions = SPIRALS[0];
      let kept = 0;
      if (inRange === 0) {
        for (let k = 0; k < SHELL_POINTS; k++) keptIndex[k] = k;
        kept = SHELL_POINTS;
      } else {
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
          const candidates = SPIRALS[attempt];
          const count = SHELL_POINTS + 2 * attempt;
          let passed = 0;
          for (let k = 0; k < count; k++) {
            const px = radius * candidates[3 * k];
            const py = radius * candidates[3 * k + 1];
            const pz = radius * candidates[3 * k + 2];
            let free = true;
            for (let q = 0; q < inRange; q++) {
              const dx = px - localX[q], dy = py - localY[q], dz = pz - localZ[q];
              if (dx * dx + dy * dy + dz * dz < limitSquared) {
                free = false;
                break;
              }
            }
            if (free) keptIndex[passed++] = k;
            else if (passed + count - 1 - k < SHELL_POINTS) break;
          }
          if (passed >= SHELL_POINTS) {
            directions = candidates;
            kept = passed;
            break;
          }
        }
      }
      if (kept < SHELL_POINTS) continue;

      const expected = referenceScale * SHELL_GAUSSIAN[shell] + referenceOffset;
      const before = points;
      for (let i = 0; i < kept; i++) {
        const k = keptIndex[i];
        const value = sample(
          cx + radius * directions[3 * k],
          cy + radius * directions[3 * k + 1],
          cz + radius * directions[3 * k + 2],
        );
        if (Number.isNaN(value)) continue;
        observed[points] = value;
        reference[points] = expected;
        points++;
      }
      if (points > before) radii++;
    }

    if (radii >= MIN_RADII) values[row] = pearson(observed, reference, points);
  }

  return { values, mateCount };
}

// Correlation about the mean of the first `count` entries; NaN when the observed values are
// flat (to within rounding) or the reference is.
function pearson(observed: Float64Array, reference: Float64Array, count: number): number {
  let low = Infinity;
  let high = -Infinity;
  let sumObserved = 0;
  let sumReference = 0;
  for (let i = 0; i < count; i++) {
    const o = observed[i];
    if (o < low) low = o;
    if (o > high) high = o;
    sumObserved += o;
    sumReference += reference[i];
  }
  if (!(high - low > 1e-12 * Math.max(Math.abs(low), Math.abs(high)))) return NaN;
  const meanObserved = sumObserved / count;
  const meanReference = sumReference / count;
  let squareObserved = 0;
  let squareReference = 0;
  let product = 0;
  for (let i = 0; i < count; i++) {
    const o = observed[i] - meanObserved;
    const r = reference[i] - meanReference;
    squareObserved += o * o;
    squareReference += r * r;
    product += o * r;
  }
  const spread = squareObserved * squareReference;
  if (!(spread > 0)) return NaN;
  return Math.max(-1, Math.min(1, product / Math.sqrt(spread)));
}
