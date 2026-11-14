import type { AtomTable, ResidueEntry } from "../model/atoms";
import { isHeavy } from "../model/atoms";
import { residueKey } from "../model/keys";
import type { MapSampler } from "./map";
import type { Track } from "./tracks";
import { makeTrack } from "./tracks";

// Real-space correlation of a model with a map, per residue, computed without structure
// factors: the model's density is simulated as one Gaussian per atom (electron count times
// occupancy, width from the B-factor plus a blur standing in for the resolution cut), put
// on a regular lattice, and correlated with the map over the lattice points near the
// residue's atoms. It approximates the validation report's RSCC, which uses an Fc map; it
// is not that number. Atoms outside the model (symmetry mates, bulk solvent) are absent
// from the simulated density, so residues at lattice contacts read lower than they should.
// The default blur and mask radius are the ones that agreed best with the stored RSCC of
// two deposited models (4N0X at 1.63 A, 7APT at 1.13 A); other resolutions are untested.

export interface RealSpaceCorrelationOptions {
  /** resolution limit of the data in A: sets the blur and the lattice spacing */
  resolution: number;
  /** the blur added to every B is blurFactor * resolution^2, in A^2 */
  blurFactor?: number;
  /** lattice points within this distance of a residue's atoms are correlated; A */
  maskRadius?: number;
  /** lattice spacing in A; coarsened automatically for very large models */
  spacing?: number;
}

// The lattice points a residue is scored over are its mask. A model's own mask for a residue
// is every point within maskRadius of the residue's heavy atoms in any of the model's frames
// (every altloc, every ensemble member), so a model with more states has a larger mask and
// is scored over more space. To compare models, score them over the same points:
//   own           each model over its own mask (what the validation-report number resembles)
//   union         every model over the points in any model's mask
//   intersection  every model over the points in every model's mask
//   { of: n }     every model over the mask of model n
// Only the models that have the residue enter a union or an intersection.
export type MaskRule = "own" | "union" | "intersection" | { of: number };

export interface JointCorrelationOptions extends RealSpaceCorrelationOptions {
  /** default "own" */
  mask?: MaskRule;
  /** residues to score; the others still contribute to the simulated densities. Default: all */
  include?: (residue: ResidueEntry) => boolean;
  /** metricId of the returned tracks; default "rscc-computed" */
  metricId?: string;
}

/** Which atoms of a residue a selection takes: none (false), all (true), or the named ones. */
export type AtomSelector = (residue: ResidueEntry) => boolean | ReadonlySet<string>;

export interface SelectionCorrelationOptions extends RealSpaceCorrelationOptions {
  select: AtomSelector;
  /** default "union" */
  mask?: MaskRule;
}

export interface SelectionCorrelation {
  /** per model: the correlation over the mask of the whole selection (NaN when it cannot be
   * taken), and the number of lattice points it was taken over */
  pooled: { value: number; points: number }[];
  /** per model: the selection's residues one by one, each over the mask of its selected
   * atoms; keyed by the residues of the model's first frame that the selection touches */
  residues: Track[];
}

export const RSCC_DEFAULT_BLUR_FACTOR = 6;
export const RSCC_DEFAULT_MASK_RADIUS = 1.5;
const MAX_LATTICE_POINTS = 6_000_000;
const MAX_ATOM_REACH = 3.5;
const MIN_POINTS = 8;
const MAX_JOINT_MODELS = 8;

const ELECTRONS: Record<string, number> = {
  C: 6, N: 7, O: 8, F: 9, NA: 11, MG: 12, P: 15, S: 16, CL: 17, K: 19, CA: 20,
  MN: 25, FE: 26, CO: 27, NI: 28, CU: 29, ZN: 30, SE: 34, BR: 35, I: 53,
};

/** `states` is the model as its coordinate frames (one table, or one per ensemble member);
 * every frame contributes its atoms at their occupancies. The track is keyed by the first
 * frame's residues; NaN where too few lattice points carry map data. */
export function realSpaceCorrelation(
  states: readonly AtomTable[],
  sample: MapSampler,
  options: RealSpaceCorrelationOptions,
): Track {
  return realSpaceCorrelationJoint([states], sample, { ...options, mask: "own" })[0];
}

/** Several models against one map in one pass: one lattice over all of them, one simulated
 * density per model, the map sampled once, and each residue scored over the points the mask
 * rule gives. Residues are matched across models by author chain, number and insertion
 * code. Returns a track per model, keyed by that model's first frame; a residue a model
 * lacks has no entry in that model's track. */
export function realSpaceCorrelationJoint(
  models: readonly (readonly AtomTable[])[],
  sample: MapSampler,
  options: JointCorrelationOptions,
): Track[] {
  const metricId = options.metricId ?? "rscc-computed";
  // a model's residue is scored when its first frame has it and `include` lets it through
  const scored = models.map((states) => {
    const keys = new Map<string, readonly string[]>();
    for (const residue of states[0].residues) {
      if (options.include && !options.include(residue)) continue;
      const key = residueKey(residue.ref);
      keys.set(key, [key]);
    }
    return keys;
  });
  const scores = scoreGroups(
    models,
    sample,
    options,
    options.mask ?? "own",
    (model, residue) => {
      const keys = scored[model].get(residueKey(residue.ref));
      return keys ? { keys } : null;
    },
    "models",
  );
  return models.map((states, m) => {
    const residues = states[0].residues;
    const values = new Float32Array(residues.length).fill(NaN);
    residues.forEach((residue, i) => {
      const score = scores.get(residueKey(residue.ref));
      if (score) values[i] = score.values[m];
    });
    return makeTrack(metricId, "residue", residues.map((residue) => residue.ref), values);
  });
}

const POOLED = "*";

/** A selection of atoms (a locus) in several models against one map: one number per model
 * over the mask of the whole selection, and the selection's residues one by one. The
 * lattice covers the selection only, so the cost follows its size; every atom near it
 * still contributes to the simulated densities. Residues and atoms are matched across
 * models by author chain, number, insertion code and atom name. */
export function realSpaceCorrelationOfSelection(
  models: readonly (readonly AtomTable[])[],
  sample: MapSampler,
  options: SelectionCorrelationOptions,
): SelectionCorrelation {
  const scores = scoreGroups(
    models,
    sample,
    options,
    options.mask ?? "union",
    (_model, residue) => {
      const selected = options.select(residue);
      if (selected === false) return null;
      const keys = [POOLED, residueKey(residue.ref)];
      return selected === true ? { keys } : { keys, atomNames: selected };
    },
    "groups",
  );
  const pooled = scores.get(POOLED);
  return {
    pooled: models.map((_, m) => ({ value: pooled ? pooled.values[m] : NaN, points: pooled ? pooled.points[m] : 0 })),
    residues: models.map((states, m) => {
      const touched = states[0].residues.filter((residue) => scores.has(residueKey(residue.ref)));
      const values = new Float32Array(touched.length);
      touched.forEach((residue, i) => {
        values[i] = scores.get(residueKey(residue.ref))!.values[m];
      });
      return makeTrack("rscc-computed", "residue", touched.map((residue) => residue.ref), values);
    }),
  };
}

interface GroupScore {
  /** per model; NaN where the model has no atoms in the group or too few points carry data */
  values: Float64Array;
  /** per model: the lattice points the value was taken over */
  points: Int32Array;
}

/** the groups a residue's atoms belong to (all of them, or the named ones); null for none */
type Membership = (model: number, residue: ResidueEntry) => { keys: readonly string[]; atomNames?: ReadonlySet<string> } | null;

// The pass every function above runs: a density per model on one lattice, then each group
// of atoms scored per model over the points the rule admits. `bounds` says what the lattice
// covers: every atom of the models, or only the atoms that are in a group.
function scoreGroups(
  models: readonly (readonly AtomTable[])[],
  sample: MapSampler,
  options: RealSpaceCorrelationOptions,
  rule: MaskRule,
  membership: Membership,
  bounds: "models" | "groups",
): Map<string, GroupScore> {
  if (models.length > MAX_JOINT_MODELS) throw new Error(`at most ${MAX_JOINT_MODELS} models can be scored in one pass`);
  const resolution = options.resolution;
  const blur = (options.blurFactor ?? RSCC_DEFAULT_BLUR_FACTOR) * resolution * resolution;
  const maskRadius = options.maskRadius ?? RSCC_DEFAULT_MASK_RADIUS;
  const modelCount = models.length;

  // --- per model: the atoms of every frame, flat; per group: its atoms in each model ---
  const xs: number[][] = [];
  const ys: number[][] = [];
  const zs: number[][] = [];
  const amplitudes: number[][] = [];
  const exponents: number[][] = [];
  const groups = new Map<string, number[][]>();
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  models.forEach((states, m) => {
    const modelXs: number[] = [], modelYs: number[] = [], modelZs: number[] = [];
    const modelAmplitudes: number[] = [], modelExponents: number[] = [];
    for (const table of states) {
      for (const residue of table.residues) {
        const member = membership(m, residue);
        const lists = member
          ? member.keys.map((key) => {
              let perModel = groups.get(key);
              if (!perModel) {
                perModel = models.map(() => []);
                groups.set(key, perModel);
              }
              return perModel[m];
            })
          : null;
        for (const row of residue.rows) {
          if (!isHeavy(table, row)) continue;
          const occupancy = table.occupancy[row];
          if (!(occupancy > 0)) continue;
          const b = table.bIso[row];
          const width = Math.max(1, Number.isNaN(b) ? 20 : b) + blur;
          const x = table.x[row], y = table.y[row], z = table.z[row];
          const grouped = !!lists && (!member?.atomNames || member.atomNames.has(table.atomName[row]));
          if (grouped) for (const list of lists) list.push(modelXs.length);
          modelXs.push(x);
          modelYs.push(y);
          modelZs.push(z);
          modelAmplitudes.push(occupancy * (ELECTRONS[table.element[row]] ?? 8) * Math.pow((4 * Math.PI) / width, 1.5));
          modelExponents.push((4 * Math.PI * Math.PI) / width);
          if (bounds === "groups" && !grouped) continue;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
      }
    }
    xs[m] = modelXs;
    ys[m] = modelYs;
    zs[m] = modelZs;
    amplitudes[m] = modelAmplitudes;
    exponents[m] = modelExponents;
  });

  const scores = new Map<string, GroupScore>();
  if (!(minX <= maxX)) return scores;

  // --- one lattice over the bounding box ---
  const pad = maskRadius + 1;
  const volume = (maxX - minX + 2 * pad) * (maxY - minY + 2 * pad) * (maxZ - minZ + 2 * pad);
  const spacing = Math.max(
    options.spacing ?? Math.min(0.7, Math.max(0.35, resolution / 4)),
    Math.cbrt(volume / MAX_LATTICE_POINTS),
  );
  const originX = minX - pad, originY = minY - pad, originZ = minZ - pad;
  const nx = Math.ceil((maxX - minX + 2 * pad) / spacing) + 1;
  const ny = Math.ceil((maxY - minY + 2 * pad) / spacing) + 1;
  const nz = Math.ceil((maxZ - minZ + 2 * pad) / spacing) + 1;
  const total = nx * ny * nz;

  // every lattice point within `reach` of (x, y, z)
  const eachPointNear = (x: number, y: number, z: number, reach: number, visit: (index: number, squared: number) => void) => {
    const i0 = Math.max(0, Math.ceil((x - reach - originX) / spacing));
    const i1 = Math.min(nx - 1, Math.floor((x + reach - originX) / spacing));
    const j0 = Math.max(0, Math.ceil((y - reach - originY) / spacing));
    const j1 = Math.min(ny - 1, Math.floor((y + reach - originY) / spacing));
    const k0 = Math.max(0, Math.ceil((z - reach - originZ) / spacing));
    const k1 = Math.min(nz - 1, Math.floor((z + reach - originZ) / spacing));
    const limit = reach * reach;
    for (let k = k0; k <= k1; k++) {
      const dz = originZ + k * spacing - z;
      for (let j = j0; j <= j1; j++) {
        const dy = originY + j * spacing - y;
        const partial = dz * dz + dy * dy;
        if (partial > limit) continue;
        const base = (k * ny + j) * nx;
        for (let i = i0; i <= i1; i++) {
          const dx = originX + i * spacing - x;
          const squared = partial + dx * dx;
          if (squared <= limit) visit(base + i, squared);
        }
      }
    }
  };

  // --- the simulated densities: each atom splatted out to where it has decayed to 0.1%
  // (an atom out of reach of the lattice visits no point) ---
  const calculated: Float32Array[] = [];
  for (let m = 0; m < modelCount; m++) {
    const grid = new Float32Array(total);
    calculated.push(grid);
    for (let a = 0; a < xs[m].length; a++) {
      const amplitude = amplitudes[m][a];
      const exponent = exponents[m][a];
      const reach = Math.min(MAX_ATOM_REACH, Math.sqrt(Math.log(1000) / exponent));
      eachPointNear(xs[m][a], ys[m][a], zs[m][a], reach, (index, squared) => {
        grid[index] += amplitude * Math.exp(-exponent * squared);
      });
    }
  }

  // --- per group: which models cover each point near it, then the correlation of the map
  // with each model's density over the points the rule admits ---
  const observed = new Float32Array(total);
  const sampled = new Uint8Array(total);
  const cover = new Uint8Array(total);
  const touched: number[] = [];
  for (const [key, atomsByModel] of groups) {
    const score: GroupScore = { values: new Float64Array(modelCount).fill(NaN), points: new Int32Array(modelCount) };
    scores.set(key, score);
    let present = 0;
    touched.length = 0;
    for (let m = 0; m < modelCount; m++) {
      if (!atomsByModel[m].length) continue;
      const bit = 1 << m;
      present |= bit;
      for (const a of atomsByModel[m]) {
        eachPointNear(xs[m][a], ys[m][a], zs[m][a], maskRadius, (index) => {
          const bits = cover[index];
          if (bits & bit) return;
          if (bits === 0) touched.push(index);
          cover[index] = bits | bit;
        });
      }
    }
    for (const index of touched) {
      if (sampled[index]) continue;
      const i = index % nx;
      const j = Math.floor(index / nx) % ny;
      const k = Math.floor(index / (nx * ny));
      observed[index] = sample(originX + i * spacing, originY + j * spacing, originZ + k * spacing);
      sampled[index] = 1;
    }
    for (let m = 0; m < modelCount; m++) {
      if (!(present & (1 << m))) continue;
      // a point is in the mask when it is covered by one of `any` and by all of `all`
      const any = rule === "own" ? 1 << m : typeof rule === "object" ? 1 << rule.of : present;
      const all = rule === "intersection" ? present : 0;
      const grid = calculated[m];
      let count = 0;
      let sumObserved = 0, sumCalculated = 0, sumObservedSquare = 0, sumCalculatedSquare = 0, sumProduct = 0;
      for (const index of touched) {
        const bits = cover[index];
        if ((bits & any) === 0 || (bits & all) !== all) continue;
        const o = observed[index];
        if (Number.isNaN(o)) continue;
        const c = grid[index];
        count++;
        sumObserved += o;
        sumCalculated += c;
        sumObservedSquare += o * o;
        sumCalculatedSquare += c * c;
        sumProduct += o * c;
      }
      score.points[m] = count;
      if (count < MIN_POINTS) continue;
      const covariance = count * sumProduct - sumObserved * sumCalculated;
      const spread =
        (count * sumObservedSquare - sumObserved * sumObserved) * (count * sumCalculatedSquare - sumCalculated * sumCalculated);
      if (spread > 0) score.values[m] = covariance / Math.sqrt(spread);
    }
    for (const index of touched) cover[index] = 0;
  }

  return scores;
}
