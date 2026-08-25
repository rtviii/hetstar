import type { AtomTable } from "./atoms";
import type { MolCifFile } from "./cif";
import { normValue } from "./cif";

// Continuous-motion parameterizations: TLS rigid-body groups, anisotropic B, isotropic B.
// The TLS parse is ported from app/src/lib/molstar/tls.ts (parse only; the libration
// animation stays app-side). Vectors are plain tuples so the model layer stays free of
// Mol* runtime imports.

export type Vec3Like = [number, number, number];

export interface TlsGroup {
  id: string;
  chain: string;
  ranges: { beg: number; end: number }[];
  origin: Vec3Like;
  /** unit dominant libration axis (largest eigenvector of L) */
  axis: Vec3Like;
  /** RMS libration about that axis, degrees */
  amplitudeDeg: number;
}

export interface MotionSummary {
  tlsGroups: TlsGroup[];
  hasAniso: boolean;
  /** [min, max] over finite B_iso values, or null when no B column */
  bIsoRange: [number, number] | null;
}

export function summarizeMotion(file: MolCifFile, table: AtomTable | null, blockIndex = 0): MotionSummary {
  const block = file.blocks[blockIndex];
  const aniso = block?.categories["atom_site_anisotrop"];
  let bIsoRange: [number, number] | null = null;
  if (table) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < table.count; i++) {
      const b = table.bIso[i];
      if (Number.isNaN(b)) continue;
      if (b < min) min = b;
      if (b > max) max = b;
    }
    if (min <= max) bIsoRange = [min, max];
  }
  return {
    tlsGroups: parseTlsGroups(file, blockIndex),
    hasAniso: !!aniso && aniso.rowCount > 0,
    bIsoRange,
  };
}

export function parseTlsGroups(file: MolCifFile, blockIndex = 0): TlsGroup[] {
  const block = file.blocks[blockIndex];
  if (!block) return [];
  const tls = block.categories["pdbx_refine_tls"];
  const grp = block.categories["pdbx_refine_tls_group"];
  if (!tls || !grp) return [];

  const idF = tls.getField("id");
  const ox = tls.getField("origin_x");
  const oy = tls.getField("origin_y");
  const oz = tls.getField("origin_z");
  const L = (i: number, j: number) => tls.getField(`L[${i}][${j}]`);
  const L11 = L(1, 1);
  const L22 = L(2, 2);
  const L33 = L(3, 3);
  const L12 = L(1, 2);
  const L13 = L(1, 3);
  const L23 = L(2, 3);

  const byId = new Map<string, { origin: Vec3Like; axis: Vec3Like; amplitudeDeg: number }>();
  for (let r = 0; r < tls.rowCount; r++) {
    const id = normValue(idF?.str(r)) || String(r + 1);
    const origin: Vec3Like = [ox?.float(r) ?? 0, oy?.float(r) ?? 0, oz?.float(r) ?? 0];
    const l11 = L11?.float(r) ?? 0;
    const l22 = L22?.float(r) ?? 0;
    const l33 = L33?.float(r) ?? 0;
    const l12 = L12?.float(r) ?? 0;
    const l13 = L13?.float(r) ?? 0;
    const l23 = L23?.float(r) ?? 0;
    const { axis, amplitudeDeg } = dominantLibration([l11, l12, l13, l12, l22, l23, l13, l23, l33]);
    byId.set(id, { origin, axis, amplitudeDeg });
  }

  const gid = grp.getField("refine_tls_id");
  const gchain = grp.getField("beg_auth_asym_id");
  const gbeg = grp.getField("beg_auth_seq_id");
  const gend = grp.getField("end_auth_seq_id");
  const ranges = new Map<string, { chain: string; ranges: { beg: number; end: number }[] }>();
  for (let r = 0; r < grp.rowCount; r++) {
    const tid = normValue(gid?.str(r));
    if (!tid) continue;
    const beg = gbeg?.int(r);
    const end = gend?.int(r);
    if (beg == null || end == null || Number.isNaN(beg) || Number.isNaN(end)) continue;
    const cur = ranges.get(tid) ?? { chain: normValue(gchain?.str(r)), ranges: [] };
    cur.ranges.push({ beg, end });
    ranges.set(tid, cur);
  }

  const groups: TlsGroup[] = [];
  for (const [tid, rg] of ranges) {
    const t = byId.get(tid);
    if (!t || !rg.ranges.length) continue;
    groups.push({ id: tid, chain: rg.chain, ranges: rg.ranges, origin: t.origin, axis: t.axis, amplitudeDeg: t.amplitudeDeg });
  }
  return groups;
}

// Dominant libration = eigenvector of the largest eigenvalue of L (deg^2), amplitude = sqrt.
function dominantLibration(L: number[]): { axis: Vec3Like; amplitudeDeg: number } {
  const { values, vectors } = symmetricEigen3(L);
  let mi = 0;
  for (let i = 1; i < 3; i++) if (values[i] > values[mi]) mi = i;
  const lam = Math.max(values[mi], 0);
  const ev = vectors[mi];
  const len = Math.hypot(ev[0], ev[1], ev[2]);
  const axis: Vec3Like = len > 0 && Number.isFinite(len) ? [ev[0] / len, ev[1] / len, ev[2] / len] : [0, 0, 1];
  return { axis, amplitudeDeg: Math.sqrt(lam) };
}

// Cyclic Jacobi on a symmetric 3x3 given row-major as 9 numbers.
function symmetricEigen3(m: number[]): { values: number[]; vectors: number[][] } {
  let a = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iter = 0; iter < 100; iter++) {
    let p = 0;
    let q = 1;
    let off = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > off) {
      off = Math.abs(a[0][2]);
      p = 0;
      q = 2;
    }
    if (Math.abs(a[1][2]) > off) {
      off = Math.abs(a[1][2]);
      p = 1;
      q = 2;
    }
    if (off < 1e-10) break;
    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const J = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    J[p][p] = c;
    J[q][q] = c;
    J[p][q] = s;
    J[q][p] = -s;
    a = matMul(transpose3(J), matMul(a, J));
    v = matMul(v, J);
  }
  return {
    values: [a[0][0], a[1][1], a[2][2]],
    vectors: [
      [v[0][0], v[1][0], v[2][0]],
      [v[0][1], v[1][1], v[2][1]],
      [v[0][2], v[1][2], v[2][2]],
    ],
  };
}

function matMul(a: number[][], b: number[][]): number[][] {
  const r = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}

function transpose3(a: number[][]): number[][] {
  return [
    [a[0][0], a[1][0], a[2][0]],
    [a[0][1], a[1][1], a[2][1]],
    [a[0][2], a[1][2], a[2][2]],
  ];
}
