import { describe, expect, it } from "vitest";

import { buildAtomTable, parseCifText, type AtomTable } from "../src/model";
import {
  metricNeeds,
  qScore,
  qScoreAtoms,
  resolveMetric,
  spherePoints,
  symmetryMates,
  symmetryOperatorFromColumnMajor,
  type MapSampler,
} from "../src/metrics";

const ATOM_SITE_HEADER = `data_test
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.auth_seq_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.pdbx_PDB_model_num
`;

interface AtomSpec {
  at: [number, number, number];
  name?: string;
  element?: string;
  alt?: string;
  comp?: string;
  seq?: number;
  occupancy?: number;
}

async function model(atoms: AtomSpec[]): Promise<AtomTable> {
  const rows = atoms.map((atom, i) => {
    const comp = atom.comp ?? "ALA";
    const seq = atom.seq ?? 1;
    return [
      comp === "HOH" ? "HETATM" : "ATOM",
      i + 1,
      atom.element ?? "C",
      atom.name ?? "CA",
      atom.alt ?? ".",
      comp,
      "A",
      seq,
      "?",
      atom.at[0],
      atom.at[1],
      atom.at[2],
      atom.occupancy ?? 1,
      15.0,
      seq,
      comp,
      "A",
      1,
    ].join(" ");
  });
  return buildAtomTable(await parseCifText(ATOM_SITE_HEADER + rows.join("\n") + "\n"))!;
}

/** a sum of Gaussians of width `sigma`, one per centre */
function blobs(centres: [number, number, number][], sigma: number): MapSampler {
  return (x, y, z) => {
    let density = 0;
    for (const [cx, cy, cz] of centres) {
      density += Math.exp((-0.5 * ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2)) / (sigma * sigma));
    }
    return density;
  };
}

/** a map with no symmetry about any atom, so that a change in the sampled points changes Q */
function uneven(centres: [number, number, number][]): MapSampler {
  const smooth = blobs(centres, 0.8);
  return (x, y, z) => smooth(x, y, z) + 0.05 * Math.sin(1.3 * x + 0.7 * y) + 0.02 * z + 0.03 * Math.cos(2.1 * z - x);
}

/** wraps a sampler and keeps every point it is asked for */
function recording(sample: MapSampler): { sample: MapSampler; points: [number, number, number][] } {
  const points: [number, number, number][] = [];
  return {
    points,
    sample: (x, y, z) => {
      points.push([x, y, z]);
      return sample(x, y, z);
    },
  };
}

function translation(x: number, y: number, z: number): number[] {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("Q-score", () => {
  it("should_score_close_to_one_when_an_isolated_atom_sits_in_a_gaussian_blob_of_sigma_0_6", async () => {
    // given
    const table = await model([{ at: [3, -2, 5] }]);
    const map = blobs([[3, -2, 5]], 0.6);

    // when
    const result = qScore([table], map);

    // then
    expect(result.atoms[0][0]).toBeGreaterThan(0.999999);
    expect(result.track.metricId).toBe("qscore");
    expect(result.track.values[0]).toBeGreaterThan(0.9999);
  });

  it("should_be_undefined_when_the_map_is_flat", async () => {
    // given
    const table = await model([{ at: [0, 0, 0] }]);

    // when
    const result = qScore([table], () => 0.1);

    // then
    expect(Number.isNaN(result.atoms[0][0])).toBe(true);
    expect(Number.isNaN(result.track.values[0])).toBe(true);
  });

  it("should_score_near_zero_when_the_map_is_noise", async () => {
    // given
    const atoms: AtomSpec[] = [];
    for (let i = 0; i < 40; i++) atoms.push({ at: [10 * i, 0, 0], comp: "GLY", seq: i + 1 });
    const table = await model(atoms);
    let state = 12345;
    const noise: MapSampler = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // when
    const values = qScoreAtoms(table, noise).values;

    // then
    let sum = 0;
    for (const value of values) {
      expect(Math.abs(value)).toBeLessThan(0.35);
      sum += value;
    }
    expect(Math.abs(sum / values.length)).toBeLessThan(0.05);
  });

  it("should_not_change_when_the_map_is_scaled_and_offset", async () => {
    // given
    const centres: [number, number, number][] = [[0, 0, 0], [1.5, 0, 0], [2.2, 1.3, 0]];
    const table = await model(centres.map((at, i) => ({ at, name: ["N", "CA", "C"][i] })));
    const map = uneven(centres);

    // when
    const plain = qScoreAtoms(table, map).values;
    const transformed = qScoreAtoms(table, (x, y, z) => 3 * map(x, y, z) - 7).values;

    // then
    for (let row = 0; row < table.count; row++) {
      expect(plain[row]).toBeLessThan(0.999);
      expect(transformed[row]).toBeCloseTo(plain[row], 10);
    }
  });

  it("should_not_change_when_the_reference_is_scaled_and_offset", async () => {
    // given
    const centres: [number, number, number][] = [[0, 0, 0], [1.5, 0, 0], [2.2, 1.3, 0]];
    const table = await model(centres.map((at, i) => ({ at, name: ["N", "CA", "C"][i] })));
    const map = uneven(centres);

    // when
    const plain = qScoreAtoms(table, map).values;
    const transformed = qScoreAtoms(table, map, { referenceScale: 4.2, referenceOffset: -0.9 }).values;

    // then
    for (let row = 0; row < table.count; row++) expect(transformed[row]).toBeCloseTo(plain[row], 10);
  });

  it("should_place_the_poles_at_minus_z_and_plus_z_when_the_spiral_has_eight_points", () => {
    // given
    const centre = [1, 2, 3];
    const radius = 0.5;

    // when
    const points = spherePoints(centre[0], centre[1], centre[2], radius, 8);

    // then
    expect(points.length).toBe(24);
    expect(points[0]).toBeCloseTo(1, 12);
    expect(points[1]).toBeCloseTo(2, 12);
    expect(points[2]).toBeCloseTo(2.5, 12);
    expect(points[21]).toBeCloseTo(1, 12);
    expect(points[22]).toBeCloseTo(2, 12);
    expect(points[23]).toBeCloseTo(3.5, 12);
    // the second point: h = -5/7, theta = 3.6 / sqrt(8 * (1 - 25/49)) = 1.818653...
    const theta = 3.6 / Math.sqrt((8 * 24) / 49);
    expect(theta).toBeCloseTo(1.818653, 5);
    expect(points[3]).toBeCloseTo(1 + 0.5 * (Math.sqrt(24) / 7) * Math.cos(theta), 12);
    expect(points[4]).toBeCloseTo(2 + 0.5 * (Math.sqrt(24) / 7) * Math.sin(theta), 12);
    expect(points[5]).toBeCloseTo(3 - 0.5 * (5 / 7), 12);
    for (let k = 0; k < 8; k++) {
      expect(distance([points[3 * k], points[3 * k + 1], points[3 * k + 2]], centre)).toBeCloseTo(radius, 12);
    }
  });

  it("should_drop_the_shell_points_on_the_side_of_a_neighbour_when_it_is_1_5_angstrom_away", async () => {
    // given
    const neighbour: [number, number, number] = [0, 0, 1.5];
    const alone = await model([{ at: [0, 0, 0] }]);
    const bonded = await model([{ at: [0, 0, 0] }, { at: neighbour, name: "CB" }]);
    const map = uneven([[0, 0, 0], neighbour]);
    const aloneRecord = recording(map);
    const bondedRecord = recording(map);

    // when
    const aloneQ = qScoreAtoms(alone, aloneRecord.sample).values[0];
    const bondedQ = qScoreAtoms(bonded, bondedRecord.sample).values[0];

    // then
    // the first atom's samples end where the second atom's centre is sampled
    const end = bondedRecord.points.findIndex((p) => distance(p, neighbour) === 0);
    const own = bondedRecord.points.slice(0, end);
    expect(aloneRecord.points.length).toBe(1 + 20 * 8);
    expect(aloneRecord.points.some((p) => distance(p, [0, 0, 2]) < 1e-9)).toBe(true);
    expect(own.some((p) => distance(p, [0, 0, 2]) < 1e-9)).toBe(false);
    for (const p of own) {
      const radius = distance(p, [0, 0, 0]);
      expect(distance(p, neighbour)).toBeGreaterThanOrEqual(0.9 * radius - 1e-9);
    }
    // the outermost shell: the first spiral with 8 free points, all of its free points kept
    let expected = 0;
    for (let count = 8; count <= 106 && expected < 8; count += 2) {
      const candidates = spherePoints(0, 0, 0, 2, count);
      expected = 0;
      for (let k = 0; k < count; k++) {
        if (distance([candidates[3 * k], candidates[3 * k + 1], candidates[3 * k + 2]], neighbour) >= 1.8) expected++;
      }
    }
    expect(expected).toBeGreaterThanOrEqual(8);
    expect(own.filter((p) => Math.abs(distance(p, [0, 0, 0]) - 2) < 1e-9).length).toBe(expected);
    expect(Number.isFinite(bondedQ)).toBe(true);
    expect(Math.abs(bondedQ - aloneQ)).toBeGreaterThan(1e-6);
  });

  it("should_let_altloc_copies_ignore_each_other_when_they_are_0_5_angstrom_apart", async () => {
    // given
    const a: AtomSpec = { at: [0, 0, 0], alt: "A", occupancy: 0.5 };
    const b: AtomSpec = { at: [0.5, 0, 0], alt: "B", occupancy: 0.5 };
    const map = uneven([a.at, b.at]);

    // when
    const pair = qScoreAtoms(await model([a, b]), map).values;
    const aAlone = qScoreAtoms(await model([a]), map).values[0];
    const bAlone = qScoreAtoms(await model([b]), map).values[0];
    const unlabelled = qScoreAtoms(await model([{ at: a.at }, { at: b.at, name: "CB" }]), map).values;

    // then
    expect(pair[0]).toBeCloseTo(aAlone, 12);
    expect(pair[1]).toBeCloseTo(bAlone, 12);
    expect(Math.abs(unlabelled[0] - aAlone)).toBeGreaterThan(1e-6);
    expect(Math.abs(unlabelled[1] - bAlone)).toBeGreaterThan(1e-6);
  });

  it("should_let_a_shared_atom_shadow_both_altloc_copies_and_be_shadowed_by_both", async () => {
    // given
    const a: AtomSpec = { at: [0, 0, 0], alt: "A", occupancy: 0.5 };
    const b: AtomSpec = { at: [0.5, 0, 0], alt: "B", occupancy: 0.5 };
    const shared: AtomSpec = { at: [0.25, 1.4, 0], name: "N" };
    const map = uneven([a.at, b.at, shared.at]);

    // when
    const all = qScoreAtoms(await model([a, b, shared]), map).values;
    const aAlone = qScoreAtoms(await model([a]), map).values[0];
    const bAlone = qScoreAtoms(await model([b]), map).values[0];
    const aWithShared = qScoreAtoms(await model([a, shared]), map).values;
    const bWithShared = qScoreAtoms(await model([b, shared]), map).values;

    // then
    expect(all[0]).toBeCloseTo(aWithShared[0], 12);
    expect(all[1]).toBeCloseTo(bWithShared[0], 12);
    expect(Math.abs(all[0] - aAlone)).toBeGreaterThan(1e-6);
    expect(Math.abs(all[1] - bAlone)).toBeGreaterThan(1e-6);
    expect(Math.abs(all[2] - aWithShared[1])).toBeGreaterThan(1e-6);
    expect(Math.abs(all[2] - bWithShared[1])).toBeGreaterThan(1e-6);
  });

  it("should_shadow_a_surface_atom_when_a_symmetry_mate_is_supplied_through_an_operator", async () => {
    // given
    const table = await model([{ at: [0, 0, 0] }]);
    const withRealNeighbour = await model([{ at: [0, 0, 0] }, { at: [0, 0, 1.5], name: "CB" }]);
    const map = uneven([[0, 0, 0], [0, 0, 1.5]]);

    // when
    const without = qScore([table], map);
    const withMate = qScore([table], map, { symmetryOperators: [translation(0, 0, 1.5)] });
    const reference = qScoreAtoms(withRealNeighbour, map).values[0];

    // then
    expect(without.symmetryMates).toBe(false);
    expect(without.mateCounts).toEqual([0]);
    expect(withMate.symmetryMates).toBe(true);
    expect(withMate.mateCounts).toEqual([1]);
    expect(Math.abs(withMate.atoms[0][0] - without.atoms[0][0])).toBeGreaterThan(1e-6);
    expect(withMate.atoms[0][0]).toBeCloseTo(reference, 12);
    expect(Math.abs(withMate.track.values[0] - without.track.values[0])).toBeGreaterThan(1e-6);
  });

  it("should_apply_the_altloc_rule_to_symmetry_mates_when_a_mate_carries_another_label", async () => {
    // given
    const operators = [translation(-9.5, 0, 0)];
    const labelled = await model([
      { at: [0, 0, 0], alt: "A", occupancy: 0.5 },
      { at: [10, 0, 0], alt: "B", occupancy: 0.5, seq: 2 },
    ]);
    const unlabelled = await model([{ at: [0, 0, 0] }, { at: [10, 0, 0], seq: 2 }]);
    const map = uneven([[0, 0, 0], [0.5, 0, 0], [10, 0, 0]]);

    // when
    const labelledAlone = qScoreAtoms(labelled, map).values[0];
    const labelledWithMate = qScoreAtoms(labelled, map, { symmetryOperators: operators });
    const unlabelledAlone = qScoreAtoms(unlabelled, map).values[0];
    const unlabelledWithMate = qScoreAtoms(unlabelled, map, { symmetryOperators: operators });

    // then
    // only the copy of the second atom lands near the model: at (0.5, 0, 0)
    expect(labelledWithMate.mateCount).toBe(1);
    expect(unlabelledWithMate.mateCount).toBe(1);
    expect(labelledWithMate.values[0]).toBeCloseTo(labelledAlone, 12);
    expect(Math.abs(unlabelledWithMate.values[0] - unlabelledAlone)).toBeGreaterThan(1e-6);
  });

  it("should_keep_only_the_copies_near_the_model_when_making_symmetry_mates", async () => {
    // given
    const table = await model([
      { at: [1, 2, 3], alt: "B", occupancy: 0.5 },
      { at: [2, 2, 3], element: "H", name: "HA" },
      { at: [5, 2, 3], seq: 2 },
    ]);
    // a half turn about z followed by a shift of (4, 5, 1), written column-major as Mol* stores it
    const columnMajor = [-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 4, 5, 1, 1];

    // when
    const operator = symmetryOperatorFromColumnMajor(columnMajor);
    const mates = symmetryMates(table, [operator, translation(100, 0, 0)]);

    // then
    expect(operator).toEqual([-1, 0, 0, 4, 0, -1, 0, 5, 0, 0, 1, 1, 0, 0, 0, 1]);
    expect(mates.count).toBe(2);
    expect([mates.x[0], mates.y[0], mates.z[0]]).toEqual([3, 3, 4]);
    expect([mates.x[1], mates.y[1], mates.z[1]]).toEqual([-1, 3, 4]);
    expect(Array.from(mates.row)).toEqual([0, 2]);
    expect(Array.from(mates.operator)).toEqual([0, 0]);
    expect(mates.altLabels[mates.alt[0]]).toBe("B");
    expect(mates.altLabels[mates.alt[1]]).toBe("");
    expect(() => symmetryMates(table, [columnMajor])).toThrow();
  });

  it("should_average_the_members_when_the_model_is_an_ensemble_of_two", async () => {
    // given
    const first = await model([{ at: [0, 0, 0] }, { at: [0, 0, 1.5], name: "CB" }]);
    const second = await model([{ at: [0.3, 0, 0] }, { at: [1.6, 0.4, 0], name: "CB" }]);
    const map = uneven([[0, 0, 0], [0, 0, 1.5]]);

    // when
    const firstQ = qScore([first], map).track.values[0];
    const secondQ = qScore([second], map).track.values[0];
    const ensemble = qScore([first, second], map);

    // then
    expect(Math.abs(firstQ - secondQ)).toBeGreaterThan(1e-3);
    expect(ensemble.atoms.length).toBe(2);
    expect(ensemble.track.keys).toEqual([{ chain: "A", seq: 1, ins: "" }]);
    expect(ensemble.track.values[0]).toBeCloseTo((firstQ + secondQ) / 2, 6);
  });

  it("should_weight_atoms_by_occupancy_and_report_only_polymer_residues", async () => {
    // given
    const heavy: AtomSpec[] = [
      { at: [0, 0, 0], name: "CA" },
      { at: [1.5, 0, 0], name: "CB", occupancy: 0.4 },
      { at: [0, 0, 2.6], name: "O", element: "O", comp: "HOH", seq: 101 },
    ];
    const hydrogen: AtomSpec = { at: [0, 1, 0], name: "HA", element: "H" };
    const table = await model([heavy[0], heavy[1], hydrogen, heavy[2]]);
    const withoutHydrogen = await model(heavy);
    const map = uneven(heavy.map((atom) => atom.at));

    // when
    const result = qScore([table], map);
    const reference = qScoreAtoms(withoutHydrogen, map).values;

    // then
    const atoms = result.atoms[0];
    expect(Number.isNaN(atoms[2])).toBe(true);
    expect(atoms[0]).toBeCloseTo(reference[0], 12);
    expect(atoms[1]).toBeCloseTo(reference[1], 12);
    expect(atoms[3]).toBeCloseTo(reference[2], 12);
    expect(result.track.keys.map((key) => key.seq)).toEqual([1, 101]);
    expect(result.track.values[0]).toBeCloseTo((atoms[0] + 0.4 * atoms[1]) / 1.4, 6);
    expect(Math.abs(atoms[0] - atoms[1])).toBeGreaterThan(1e-3);
    expect(Number.isNaN(result.track.values[1])).toBe(true);
  });

  it("should_be_undefined_when_fewer_than_three_radii_carry_map_data", async () => {
    // given
    const table = await model([{ at: [0, 0, 0] }]);
    const map = blobs([[0, 0, 0]], 0.6);
    const within = (limit: number): MapSampler => (x, y, z) => (Math.hypot(x, y, z) > limit ? NaN : map(x, y, z));

    // when
    const twoRadii = qScoreAtoms(table, within(0.15)).values[0];
    const threeRadii = qScoreAtoms(table, within(0.25)).values[0];

    // then
    expect(Number.isNaN(twoRadii)).toBe(true);
    expect(threeRadii).toBeGreaterThan(0.999999);
  });

  it("should_match_a_direct_transcription_of_the_rule_when_the_model_is_a_dense_cluster", async () => {
    // given
    let state = 2026;
    const random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const edge = 8.3;
    const atoms: AtomSpec[] = [];
    while (atoms.length < 40) {
      const at: [number, number, number] = [random() * edge, random() * edge, random() * edge];
      if (atoms.some((atom) => distance(atom.at, at) < 1.2)) continue;
      const label = ["", "", "A", "B"][Math.floor(random() * 4)];
      atoms.push({
        at,
        alt: label || ".",
        element: atoms.length % 13 === 5 ? "H" : "C",
        name: `C${atoms.length}`,
        seq: 1 + Math.floor(atoms.length / 5),
        occupancy: label ? 0.5 : 1,
      });
    }
    const table = await model(atoms);
    const cell = edge + 1.5;
    const operators: number[][] = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) if (i || j || k) operators.push(translation(i * cell, j * cell, k * cell));
      }
    }
    const map = uneven(atoms.slice(0, 12).map((atom) => atom.at));

    // every heavy atom and every one of its copies, with no cut-off and no grid
    const neighbours: { at: number[]; alt: string }[] = [];
    for (const atom of atoms) {
      if (atom.element === "H") continue;
      const alt = atom.alt === "." ? "" : atom.alt!;
      neighbours.push({ at: atom.at, alt });
      for (const m of operators) neighbours.push({ at: [atom.at[0] + m[3], atom.at[1] + m[7], atom.at[2] + m[11]], alt });
    }
    const direct = (atom: AtomSpec): number => {
      const alt = atom.alt === "." ? "" : atom.alt!;
      const shadows = neighbours.filter((other) => alt === "" || other.alt === "" || other.alt === alt);
      const observed: number[] = [];
      const expected: number[] = [];
      for (let copy = 0; copy < 8; copy++) {
        observed.push(map(atom.at[0], atom.at[1], atom.at[2]));
        expected.push(1);
      }
      for (let shell = 1; shell <= 20; shell++) {
        const radius = 0.1 * shell;
        for (let count = 8; count <= 106; count += 2) {
          const candidates = spherePoints(atom.at[0], atom.at[1], atom.at[2], radius, count);
          const free: number[][] = [];
          for (let k = 0; k < count; k++) {
            const point = [candidates[3 * k], candidates[3 * k + 1], candidates[3 * k + 2]];
            if (!shadows.some((other) => distance(other.at, point) < 0.9 * radius)) free.push(point);
          }
          if (free.length < 8) continue;
          for (const point of free) {
            observed.push(map(point[0], point[1], point[2]));
            expected.push(Math.exp(-0.5 * (radius / 0.6) ** 2));
          }
          break;
        }
      }
      const mean = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
      const meanObserved = mean(observed);
      const meanExpected = mean(expected);
      let product = 0;
      let squareObserved = 0;
      let squareExpected = 0;
      observed.forEach((value, i) => {
        product += (value - meanObserved) * (expected[i] - meanExpected);
        squareObserved += (value - meanObserved) ** 2;
        squareExpected += (expected[i] - meanExpected) ** 2;
      });
      return product / Math.sqrt(squareObserved * squareExpected);
    };

    // when
    const scored = qScoreAtoms(table, map, { symmetryOperators: operators });

    // then
    expect(scored.mateCount).toBeGreaterThan(100);
    atoms.forEach((atom, row) => {
      if (atom.element === "H") expect(Number.isNaN(scored.values[row])).toBe(true);
      else expect(scored.values[row]).toBeCloseTo(direct(atom), 9);
    });
  });

  it("should_resolve_through_the_registry_when_the_map_is_there", async () => {
    // given
    const table = await model([{ at: [0, 0, 0] }, { at: [0, 0, 1.5], name: "CB" }]);
    const map = uneven([[0, 0, 0], [0, 0, 1.5]]);
    const operators = [translation(1.4, 0, 0)];

    // when
    const needs = metricNeeds("qscore");
    const missing = resolveMetric("qscore", { table });
    const alone = resolveMetric("qscore", { table, maps: { twoFoFc: map } });
    const inCrystal = resolveMetric("qscore", { table, maps: { twoFoFc: map }, symmetryOperators: operators });

    // then
    expect(needs).toEqual({ reference: false, ensemble: false, states: true, map: "2fofc" });
    expect(missing).toEqual({ missing: "map" });
    expect(alone).toEqual({ track: qScore([table], map).track });
    expect(inCrystal).toEqual({ track: qScore([table], map, { symmetryOperators: operators }).track });
    expect(inCrystal).not.toEqual(alone);
  });
});
