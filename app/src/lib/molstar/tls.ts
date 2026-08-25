import { Vec3 } from "molstar/lib/mol-math/linear-algebra/3d/vec3";
import { asMolCifFile } from "@/lib/cif-source/types";

// TLS (Translation/Libration/Screw) rigid-body groups parsed from `_pdbx_refine_tls` (the T/L/S
// tensors + origin per group) and `_pdbx_refine_tls_group` (the residue ranges each group covers).
// Mol* has no native TLS visual, so we reduce each group to its dominant libration — a rocking
// rotation about the principal axis of the L tensor, through the TLS origin — which the viewer then
// animates with the `transform-structure-conformation` transform. This is an illustrative
// approximation of the rigid-body motion, not the exact screw decomposition.
export interface TlsGroup {
  id: string; // refine_tls_id
  chain: string; // auth chain id
  ranges: { beg: number; end: number }[]; // auth_seq_id ranges
  origin: Vec3; // TLS origin (Cartesian Å)
  axis: Vec3; // unit dominant libration axis
  amplitudeDeg: number; // RMS libration amplitude about that axis, in degrees
}

// Librations are typically a few degrees RMS — too small to see — so the animation scales them up,
// but clamps the result so a flexible group doesn't swing so far it looks like it's flying apart.
export const TLS_EXAGGERATION = 6;
export const TLS_MAX_ANGLE_DEG = 18;

// Distinct flat colours so each rigid body reads as a separate moving block.
export const TLS_PALETTE = [0xe6194b, 0x3cb44b, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6, 0x9a6324];

// Parse the TLS groups from a parsed CIF file (the `raw` of ParsedCif). Returns [] if the file
// carries no TLS categories.
export function parseTlsGroups(raw: unknown): TlsGroup[] {
  const block = asMolCifFile(raw).blocks[0];
  if (!block) return [];
  const tls = block.categories["pdbx_refine_tls"];
  const grp = block.categories["pdbx_refine_tls_group"];
  if (!tls || !grp) return [];

  // libration axis/amplitude + origin per TLS id
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

  const byId = new Map<string, { origin: Vec3; axis: Vec3; amplitudeDeg: number }>();
  for (let r = 0; r < tls.rowCount; r++) {
    const id = idF?.str(r) ?? String(r + 1);
    const origin = Vec3.create(ox?.float(r) ?? 0, oy?.float(r) ?? 0, oz?.float(r) ?? 0);
    const l11 = L11?.float(r) ?? 0;
    const l22 = L22?.float(r) ?? 0;
    const l33 = L33?.float(r) ?? 0;
    const l12 = L12?.float(r) ?? 0;
    const l13 = L13?.float(r) ?? 0;
    const l23 = L23?.float(r) ?? 0;
    // row-major symmetric 3x3
    const { axis, amplitudeDeg } = dominantLibration([l11, l12, l13, l12, l22, l23, l13, l23, l33]);
    byId.set(id, { origin, axis, amplitudeDeg });
  }

  // residue ranges per TLS id (a group can list several rows for one id)
  const gid = grp.getField("refine_tls_id");
  const gchain = grp.getField("beg_auth_asym_id");
  const gbeg = grp.getField("beg_auth_seq_id");
  const gend = grp.getField("end_auth_seq_id");
  const ranges = new Map<string, { chain: string; ranges: { beg: number; end: number }[] }>();
  for (let r = 0; r < grp.rowCount; r++) {
    const tid = gid?.str(r);
    if (!tid) continue;
    const chain = gchain?.str(r) ?? "";
    const beg = gbeg?.int(r);
    const end = gend?.int(r);
    if (beg == null || end == null || Number.isNaN(beg) || Number.isNaN(end)) continue;
    const cur = ranges.get(tid) ?? { chain, ranges: [] };
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

// Params for Mol*'s `transform-structure-conformation` ('components' variant): rotate `angleDeg`
// about `axis` through `origin`. Returned untyped to avoid wrestling the transform's PD param types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tlsTransformParams(axis: Vec3, angleDeg: number, origin: Vec3): any {
  return {
    transform: {
      name: "components",
      params: {
        translation: Vec3.create(0, 0, 0),
        axis,
        angle: angleDeg,
        rotationCenter: { name: "point", params: { point: origin } },
      },
    },
  };
}

// --- symmetric 3x3 eigen-decomposition (cyclic Jacobi) ---

// Dominant libration = eigenvector of the largest eigenvalue of L; amplitude = sqrt(eigenvalue)
// (L is in deg², so the square root is an RMS angle in degrees).
function dominantLibration(L: number[]): { axis: Vec3; amplitudeDeg: number } {
  const { values, vectors } = symmetricEigen3(L);
  let mi = 0;
  for (let i = 1; i < 3; i++) if (values[i] > values[mi]) mi = i;
  const lam = Math.max(values[mi], 0);
  const ev = vectors[mi];
  const axis = Vec3.normalize(Vec3(), Vec3.create(ev[0], ev[1], ev[2]));
  if (!Number.isFinite(axis[0]) || !Number.isFinite(axis[1]) || !Number.isFinite(axis[2])) Vec3.set(axis, 0, 0, 1);
  return { axis, amplitudeDeg: Math.sqrt(lam) };
}

// Returns eigenvalues and eigenvectors (vectors[k] is the eigenvector for values[k]) of a symmetric
// 3x3 matrix given row-major as 9 numbers.
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
    // largest off-diagonal element (p,q)
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
