import type { ResidueRef } from "../model/keys";
import type { Track } from "./tracks";

// The stretches of a track that stand out: runs of neighbouring residues whose value is at
// or above a threshold, ranked by their highest value. With a disagreement track these are
// the places worth looking at first.

export interface TrackSegment {
  chain: string;
  /** first and last residue of the run, in the track's order */
  start: ResidueRef;
  end: ResidueRef;
  /** residues of the run that carry a value */
  length: number;
  /** the highest value in the run and where it is */
  peak: number;
  peakAt: ResidueRef;
  /** mean over the run's residues that carry a value */
  mean: number;
}

export interface RankSegmentsOptions {
  /** residues at or above this value form the runs; default: the `quantile` of the considered values */
  threshold?: number;
  /** used when no threshold is given; default 0.9, the top tenth of the residues */
  quantile?: number;
  /** residues below the threshold a run may bridge; default 1 */
  maxGap?: number;
  /** most segments returned; default 12 */
  limit?: number;
  /** residues to consider at all (for example polymer residues only); default every residue */
  include?: (ref: ResidueRef) => boolean;
}

/** The value below which the fraction `q` of the track's defined values lie. NaN for an empty track. */
export function trackQuantile(track: Track, q: number, include?: (ref: ResidueRef) => boolean): number {
  const values: number[] = [];
  for (let i = 0; i < track.values.length; i++) {
    const value = track.values[i];
    if (Number.isNaN(value) || (include && !include(track.keys[i]))) continue;
    values.push(value);
  }
  if (!values.length) return NaN;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(q * values.length) - 1))];
}

export function rankSegments(track: Track, options: RankSegmentsOptions = {}): TrackSegment[] {
  const { include } = options;
  const threshold = options.threshold ?? trackQuantile(track, options.quantile ?? 0.9, include);
  if (Number.isNaN(threshold)) return [];
  const maxGap = options.maxGap ?? 1;

  interface Run {
    chain: string;
    first: number;
    last: number;
  }
  const runs: Run[] = [];
  let run: Run | null = null;
  for (let i = 0; i < track.keys.length; i++) {
    const key = track.keys[i];
    const value = track.values[i];
    if (Number.isNaN(value) || value < threshold || (include && !include(key))) continue;
    if (run && run.chain === key.chain && i - run.last <= maxGap + 1) {
      run.last = i;
    } else {
      run = { chain: key.chain, first: i, last: i };
      runs.push(run);
    }
  }

  const segments = runs.map((r): TrackSegment => {
    let peak = -Infinity;
    let peakIndex = r.first;
    let sum = 0;
    let length = 0;
    for (let i = r.first; i <= r.last; i++) {
      const value = track.values[i];
      if (Number.isNaN(value)) continue;
      sum += value;
      length++;
      if (value > peak) {
        peak = value;
        peakIndex = i;
      }
    }
    return {
      chain: r.chain,
      start: track.keys[r.first],
      end: track.keys[r.last],
      length,
      peak,
      peakAt: track.keys[peakIndex],
      mean: sum / length,
    };
  });
  segments.sort((a, b) => b.peak - a.peak || b.mean - a.mean);
  return segments.slice(0, options.limit ?? 12);
}
