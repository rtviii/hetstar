import type { AtomTable } from "../model/atoms";
import { isHeavy } from "../model/atoms";
import type { Track } from "./tracks";
import { makeTrack } from "./tracks";

// Motion on one scale for every kind of model. A model describes where an atom is in two
// ways: a B-factor (a harmonic cloud around each modeled position) and discrete states
// (altloc conformers, or the members of an ensemble). Both become a mean-square
// displacement in A^2, averaged over the residue's heavy atoms, and they add: the
// variance inside a state plus the variance between states is the total variance when
// the two are independent. The tracks carry the square roots, in A.

/** B = 8 pi^2 <u^2> for one axis, so the three-dimensional mean-square displacement is 3B / (8 pi^2). */
export const B_TO_MEAN_SQUARE_DISPLACEMENT = 3 / (8 * Math.PI * Math.PI);

export interface MotionTracks {
  /** from the B-factors */
  harmonic: Track;
  /** from the spread across altloc conformers or ensemble members */
  discrete: Track;
  /** sqrt(harmonic^2 + discrete^2) */
  total: Track;
}

interface AtomAccumulator {
  weight: number;
  sumX: number;
  sumY: number;
  sumZ: number;
  sumSquares: number;
  bWeight: number;
  bSum: number;
}

function atomKey(table: AtomTable, row: number): string {
  return `${table.chain[row]}|${table.seq[row]}|${table.ins[row]}|${table.atomName[row]}`;
}

const cache = new WeakMap<AtomTable, { stateCount: number; tracks: MotionTracks }>();

/** `states` is the model as its coordinate frames: one table for a single model (its altloc
 * conformers are the states, weighted by occupancy), or one table per ensemble member.
 * Atoms correspond by author residue and atom name; no superposition is performed, so the
 * frames must share the crystal frame. Tracks are keyed by the first state's residues. */
export function motionTracks(states: readonly AtomTable[]): MotionTracks {
  const first = states[0];
  const cached = cache.get(first);
  if (cached && cached.stateCount === states.length) return cached.tracks;

  const atoms = new Map<string, AtomAccumulator>();
  for (const table of states) {
    for (let row = 0; row < table.count; row++) {
      if (!isHeavy(table, row)) continue;
      const weight = table.occupancy[row];
      if (!(weight > 0)) continue;
      const key = atomKey(table, row);
      let atom = atoms.get(key);
      if (!atom) {
        atom = { weight: 0, sumX: 0, sumY: 0, sumZ: 0, sumSquares: 0, bWeight: 0, bSum: 0 };
        atoms.set(key, atom);
      }
      const x = table.x[row];
      const y = table.y[row];
      const z = table.z[row];
      atom.weight += weight;
      atom.sumX += weight * x;
      atom.sumY += weight * y;
      atom.sumZ += weight * z;
      atom.sumSquares += weight * (x * x + y * y + z * z);
      const b = table.bIso[row];
      if (!Number.isNaN(b)) {
        atom.bWeight += weight;
        atom.bSum += weight * Math.max(0, b);
      }
    }
  }

  const count = first.residues.length;
  const harmonic = new Float32Array(count);
  const discrete = new Float32Array(count);
  const total = new Float32Array(count);
  first.residues.forEach((residue, i) => {
    const seen = new Set<string>();
    let atomCount = 0;
    let spreadSum = 0;
    let bCount = 0;
    let harmonicSum = 0;
    for (const row of residue.rows) {
      if (!isHeavy(first, row)) continue;
      const key = atomKey(first, row);
      if (seen.has(key)) continue;
      seen.add(key);
      const atom = atoms.get(key);
      if (!atom) continue;
      const meanX = atom.sumX / atom.weight;
      const meanY = atom.sumY / atom.weight;
      const meanZ = atom.sumZ / atom.weight;
      spreadSum += Math.max(0, atom.sumSquares / atom.weight - (meanX * meanX + meanY * meanY + meanZ * meanZ));
      atomCount++;
      if (atom.bWeight > 0) {
        harmonicSum += B_TO_MEAN_SQUARE_DISPLACEMENT * (atom.bSum / atom.bWeight);
        bCount++;
      }
    }
    const discreteSquare = atomCount > 0 ? spreadSum / atomCount : NaN;
    const harmonicSquare = bCount > 0 ? harmonicSum / bCount : NaN;
    discrete[i] = Math.sqrt(discreteSquare);
    harmonic[i] = Math.sqrt(harmonicSquare);
    total[i] = Math.sqrt(harmonicSquare + discreteSquare);
  });

  const keys = first.residues.map((residue) => residue.ref);
  const tracks: MotionTracks = {
    harmonic: makeTrack("motion-harmonic", "residue", keys, harmonic, { unit: "A" }),
    discrete: makeTrack("motion-discrete", "residue", keys, discrete, { unit: "A" }),
    total: makeTrack("motion-total", "residue", keys, total, { unit: "A" }),
  };
  cache.set(first, { stateCount: states.length, tracks });
  return tracks;
}
