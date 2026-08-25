import { Mat4, Tensor, Vec3 } from "molstar/lib/mol-math/linear-algebra";
import type { Structure } from "molstar/lib/mol-model/structure";
import { Grid } from "molstar/lib/mol-model/volume/grid";
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { DensityVolumes } from "./density";

// FFT maps computed from structure factors cover exactly one crystallographic unit cell,
// so they render as a box sitting wherever the cell sits -- generally NOT around the
// deposited model, which lives wherever refinement left it (and most of the cell's density
// belongs to symmetry mates anyway). Mol* wraps periodic grids only when SAMPLING values
// (Grid.makeGetTrilinearlyInterpolated, used by the external-volume theme); isosurface
// meshes are built over the literal grid. The fix is to resample the periodic map onto a
// plain orthogonal grid that hugs the model: for each target voxel near an atom, map its
// position into continuous grid coordinates and wrap by the grid dimensions (lattice
// translations leave the density invariant), then trilinearly interpolate.
// Ported from dynamic-pdb's expandMapAroundModel (website StructureViewer.tsx).

const BOX_MARGIN = 3; // A beyond the model bounding box
const MAX_POINTS = 2_600_000; // coarsen spacing until the target grid fits this cap
export const CARVE_RADIUS = 2; // A; voxels farther than this from every atom stay at the map mean

/* eslint-disable @typescript-eslint/no-explicit-any */

function sampleWrapped(
  data: any,
  space: any,
  ox: number,
  oy: number,
  oz: number,
  gx: number,
  gy: number,
  gz: number,
): number {
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const z0 = Math.floor(gz);
  const dx = gx - x0;
  const dy = gy - y0;
  const dz = gz - z0;
  const xa = ((x0 % ox) + ox) % ox;
  const ya = ((y0 % oy) + oy) % oy;
  const za = ((z0 % oz) + oz) % oz;
  const xb = (xa + 1) % ox;
  const yb = (ya + 1) % oy;
  const zb = (za + 1) % oz;
  const g = space.get;
  const c000 = g(data, xa, ya, za);
  const c100 = g(data, xb, ya, za);
  const c010 = g(data, xa, yb, za);
  const c110 = g(data, xb, yb, za);
  const c001 = g(data, xa, ya, zb);
  const c101 = g(data, xb, ya, zb);
  const c011 = g(data, xa, yb, zb);
  const c111 = g(data, xb, yb, zb);
  const c00 = c000 * (1 - dx) + c100 * dx;
  const c10 = c010 * (1 - dx) + c110 * dx;
  const c01 = c001 * (1 - dx) + c101 * dx;
  const c11 = c011 * (1 - dx) + c111 * dx;
  const c0 = c00 * (1 - dy) + c10 * dy;
  const c1 = c01 * (1 - dy) + c11 * dy;
  return c0 * (1 - dz) + c1 * dz;
}

function columnLength(m: Mat4, c: number): number {
  return Math.hypot(Mat4.getValue(m, 0, c), Mat4.getValue(m, 1, c), Mat4.getValue(m, 2, c));
}

/**
 * Replace `volume.grid` (in place, before any representation is built on it) with an
 * orthogonal resampling that covers the structure's bounding box. Voxels farther than
 * `radius` from every atom keep the map mean, so no isosurface appears there at any
 * positive sigma. Source (cell-wide) stats are kept so sigma-relative iso levels retain
 * their crystallographic meaning. Returns false when the grid is not a periodic full-cell
 * map (already carved, or a box from a density server) -- those must not be index-wrapped.
 */
export function carveGridAroundStructure(volume: unknown, structure: Structure, radius = CARVE_RADIUS): boolean {
  const vol = volume as any;
  const grid = vol?.grid;
  if (!grid || grid.periodicity !== "xyz") return false;

  const lookup = structure.lookup3d;
  const box = structure.boundary.box;

  const origData = grid.cells.data;
  const origSpace = grid.cells.space;
  const [ox, oy, oz] = origSpace.dimensions as number[];
  const mean = grid.stats.mean as number;

  const gridToCartn = Grid.getGridToCartesianTransform(grid);
  const cartnToGrid = Mat4.invert(Mat4.identity(), gridToCartn);

  const minX = box.min[0] - BOX_MARGIN;
  const minY = box.min[1] - BOX_MARGIN;
  const minZ = box.min[2] - BOX_MARGIN;
  const sizeX = box.max[0] - box.min[0] + 2 * BOX_MARGIN;
  const sizeY = box.max[1] - box.min[1] + 2 * BOX_MARGIN;
  const sizeZ = box.max[2] - box.min[2] + 2 * BOX_MARGIN;

  // Start from the map's own sampling (length of one index step), coarsen under the cap.
  let spacing = Math.min(columnLength(gridToCartn, 0), columnLength(gridToCartn, 1), columnLength(gridToCartn, 2));
  if (!Number.isFinite(spacing) || spacing <= 0) spacing = 0.5;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let guard = 0; guard < 12; guard++) {
    nx = Math.max(2, Math.ceil(sizeX / spacing) + 1);
    ny = Math.max(2, Math.ceil(sizeY / spacing) + 1);
    nz = Math.max(2, Math.ceil(sizeZ / spacing) + 1);
    if (nx * ny * nz <= MAX_POINTS) break;
    spacing *= 1.26;
  }
  const stepX = sizeX / (nx - 1);
  const stepY = sizeY / (ny - 1);
  const stepZ = sizeZ / (nz - 1);

  const newData = new Float32Array(nx * ny * nz);
  newData.fill(mean);
  const newSpace = Tensor.Space([nx, ny, nz], [0, 1, 2], Float32Array);
  const F = Vec3();
  for (let i = 0; i < nx; i++) {
    const px = minX + i * stepX;
    for (let j = 0; j < ny; j++) {
      const py = minY + j * stepY;
      for (let k = 0; k < nz; k++) {
        const pz = minZ + k * stepZ;
        if (!lookup.check(px, py, pz, radius)) continue;
        Vec3.set(F, px, py, pz);
        Vec3.transformMat4(F, F, cartnToGrid);
        newSpace.set(newData as any, i, j, k, sampleWrapped(origData, origSpace, ox, oy, oz, F[0], F[1], F[2]));
      }
    }
  }

  const matrix = Mat4.identity();
  Mat4.setValue(matrix, 0, 0, stepX);
  Mat4.setValue(matrix, 1, 1, stepY);
  Mat4.setValue(matrix, 2, 2, stepZ);
  Mat4.setValue(matrix, 0, 3, minX);
  Mat4.setValue(matrix, 1, 3, minY);
  Mat4.setValue(matrix, 2, 3, minZ);

  vol.grid = {
    transform: { kind: "matrix", matrix },
    cells: Tensor.create(newSpace, Tensor.Data1(newData)),
    stats: grid.stats,
    periodicity: undefined,
  };
  return true;
}

/** Carve every volume in `vols` around the structure. Call between parse and isosurface build. */
export function carveDensityToStructure(
  ctx: PluginContext,
  vols: DensityVolumes,
  structure: Structure,
  radius = CARVE_RADIUS,
): number {
  let carved = 0;
  for (const ref of [vols.twoFoFc, vols.foFc]) {
    if (!ref) continue;
    const data = ctx.state.data.cells.get(ref)?.obj?.data;
    if (data && carveGridAroundStructure(data, structure, radius)) carved++;
  }
  return carved;
}
