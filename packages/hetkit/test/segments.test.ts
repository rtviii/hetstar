import { describe, expect, it } from "vitest";

import { makeTrack, rankSegments, trackQuantile } from "../src/metrics";

const ref = (seq: number, chain = "A") => ({ chain, seq, ins: "" });

function track(values: number[], chains?: string[]) {
  return makeTrack(
    "motion-spread",
    "residue",
    values.map((_, i) => ref(i + 1, chains?.[i] ?? "A")),
    Float32Array.from(values),
    { unit: "A" },
  );
}

describe("ranking the segments of a track", () => {
  it("groups neighbouring residues at or above the threshold and ranks by peak", () => {
    //                    1    2    3    4    5    6    7    8    9   10
    const t = track([0.1, 0.6, 0.9, 0.1, 0.1, 0.1, 0.7, 0.1, 0.1, 1.2]);
    const segments = rankSegments(t, { threshold: 0.5, maxGap: 0 });
    expect(segments.map((s) => [s.start.seq, s.end.seq])).toEqual([
      [10, 10],
      [2, 3],
      [7, 7],
    ]);
    expect(segments[1].peak).toBeCloseTo(0.9, 6);
    expect(segments[1].peakAt).toEqual(ref(3));
    expect(segments[1].mean).toBeCloseTo(0.75, 6);
    expect(segments[1].length).toBe(2);
  });

  it("bridges a single residue below the threshold by default", () => {
    const t = track([0.8, 0.1, 0.7, 0.1, 0.1, 0.9]);
    const segments = rankSegments(t, { threshold: 0.5 });
    expect(segments.map((s) => [s.start.seq, s.end.seq])).toEqual([
      [6, 6],
      [1, 3],
    ]);
    // the bridged residue counts in the mean
    expect(segments[1].mean).toBeCloseTo((0.8 + 0.1 + 0.7) / 3, 6);
  });

  it("never joins residues of different chains", () => {
    const t = track([0.9, 0.8, 0.7, 0.6], ["A", "A", "B", "B"]);
    const segments = rankSegments(t, { threshold: 0.5 });
    expect(segments.map((s) => [s.chain, s.start.seq, s.end.seq])).toEqual([
      ["A", 1, 2],
      ["B", 3, 4],
    ]);
  });

  it("defaults the threshold to the top tenth of the considered residues", () => {
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) / 20);
    const t = track(values);
    expect(trackQuantile(t, 0.9)).toBeCloseTo(0.9, 6);
    const segments = rankSegments(t);
    expect(segments).toHaveLength(1);
    expect([segments[0].start.seq, segments[0].end.seq]).toEqual([18, 20]);
  });

  it("leaves out residues the caller excludes and those without a value", () => {
    const t = track([0.9, NaN, 0.8, 0.7, 5]);
    const segments = rankSegments(t, { threshold: 0.5, maxGap: 0, include: (r) => r.seq !== 5 });
    expect(segments.map((s) => [s.start.seq, s.end.seq])).toEqual([
      [1, 1],
      [3, 4],
    ]);
    expect(rankSegments(track([NaN, NaN]))).toEqual([]);
  });

  it("returns at most the asked number of segments", () => {
    const t = track([1, 0, 0, 2, 0, 0, 3, 0, 0, 4]);
    expect(rankSegments(t, { threshold: 0.5, limit: 2 }).map((s) => s.peak)).toEqual([4, 3]);
  });
});
