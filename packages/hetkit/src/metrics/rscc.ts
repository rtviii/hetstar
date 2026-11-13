import type { AtomTable } from "../model/atoms";
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

export const RSCC_DEFAULT_BLUR_FACTOR = 6;
export const RSCC_DEFAULT_MASK_RADIUS = 1.5;
const MAX_LATTICE_POINTS = 6_000_000;
const MAX_ATOM_REACH = 3.5;
const MIN_POINTS = 8;

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
  const resolution = options.resolution;
  const blur = (options.blurFactor ?? RSCC_DEFAULT_BLUR_FACTOR) * resolution * resolution;
  const maskRadius = options.maskRadius ?? RSCC_DEFAULT_MASK_RADIUS;
  const first = states[0];

  // --- the atoms of every frame, flat, with the rows of each residue ---
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const amplitudes: number[] = [];
  const exponents: number[] = [];
  const atomsOfResidue = new Map<string, number[]>();
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const table of states) {
    for (const residue of table.residues) {
      const key = residueKey(residue.ref);
      let list = atomsOfResidue.get(key);
      for (const row of residue.rows) {
        if (!isHeavy(table, row)) continue;
        const occupancy = table.occupancy[row];
        if (!(occupancy > 0)) continue;
        const b = table.bIso[row];
        const width = Math.max(1, Number.isNaN(b) ? 20 : b) + blur;
        const x = table.x[row], y = table.y[row], z = table.z[row];
        if (!list) {
          list = [];
          atomsOfResidue.set(key, list);
        }
        list.push(xs.length);
        xs.push(x);
        ys.push(y);
        zs.push(z);
        amplitudes.push(occupancy * (ELECTRONS[table.element[row]] ?? 8) * Math.pow((4 * Math.PI) / width, 1.5));
        exponents.push((4 * Math.PI * Math.PI) / width);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    }
  }

  const values = new Float32Array(first.residues.length).fill(NaN);
  const keys = first.residues.map((residue) => residue.ref);
  if (!xs.length) return makeTrack("rscc-computed", "residue", keys, values);

  // --- the lattice over the model's bounding box ---
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
  const calculated = new Float32Array(nx * ny * nz);

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

  // --- the simulated density: each atom splatted out to where it has decayed to 0.1% ---
  for (let a = 0; a < xs.length; a++) {
    const amplitude = amplitudes[a];
    const exponent = exponents[a];
    const reach = Math.min(MAX_ATOM_REACH, Math.sqrt(Math.log(1000) / exponent));
    eachPointNear(xs[a], ys[a], zs[a], reach, (index, squared) => {
      calculated[index] += amplitude * Math.exp(-exponent * squared);
    });
  }

  // --- per residue: correlate map and simulated density over the points near its atoms ---
  const observed = new Float32Array(calculated.length);
  const sampled = new Uint8Array(calculated.length);
  const visitedBy = new Int32Array(calculated.length);
  first.residues.forEach((residue, residueIndex) => {
    const atoms = atomsOfResidue.get(residueKey(residue.ref));
    if (!atoms) return;
    const stamp = residueIndex + 1;
    let count = 0;
    let sumObserved = 0, sumCalculated = 0, sumObservedSquare = 0, sumCalculatedSquare = 0, sumProduct = 0;
    for (const a of atoms) {
      eachPointNear(xs[a], ys[a], zs[a], maskRadius, (index) => {
        if (visitedBy[index] === stamp) return;
        visitedBy[index] = stamp;
        if (!sampled[index]) {
          const i = index % nx;
          const j = Math.floor(index / nx) % ny;
          const k = Math.floor(index / (nx * ny));
          observed[index] = sample(originX + i * spacing, originY + j * spacing, originZ + k * spacing);
          sampled[index] = 1;
        }
        const o = observed[index];
        if (Number.isNaN(o)) return;
        const c = calculated[index];
        count++;
        sumObserved += o;
        sumCalculated += c;
        sumObservedSquare += o * o;
        sumCalculatedSquare += c * c;
        sumProduct += o * c;
      });
    }
    if (count < MIN_POINTS) return;
    const covariance = count * sumProduct - sumObserved * sumCalculated;
    const spread =
      (count * sumObservedSquare - sumObserved * sumObserved) * (count * sumCalculatedSquare - sumCalculated * sumCalculated);
    if (spread > 0) values[residueIndex] = covariance / Math.sqrt(spread);
  });

  return makeTrack("rscc-computed", "residue", keys, values);
}
