import { CustomProperties } from "molstar/lib/mol-model/custom-property";
import { Volume } from "molstar/lib/mol-model/volume";
import { Mat4, Tensor, Vec3 } from "molstar/lib/mol-math/linear-algebra";
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { PluginStateObject as SO, PluginStateTransform } from "molstar/lib/mol-plugin-state/objects";
import { StateTransforms } from "molstar/lib/mol-plugin-state/transforms";
import { VolumeRepresentation3DHelpers } from "molstar/lib/mol-plugin-state/transforms/representation";
import { ExternalVolumeColorThemeParams } from "molstar/lib/mol-theme/color/external-volume";
import { Task } from "molstar/lib/mol-task";
import { Color } from "molstar/lib/mol-util/color";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";

// Density-map plumbing for the /density-spike page, all against stock Mol* 5.11:
//  - structure-factor CIF (map coefficients) to 2Fo-Fc / Fo-Fc volumes via the built-in
//    "sfcif" data format provider (client-side FFT, VolumeFromStructureFactorsCif),
//  - isosurface representations with live sigma / clip-sphere updates,
//  - an arbitrary-plane slice representation,
//  - a metric field splatted onto an in-memory Volume (alpha-orbitals pattern) and
//    projected onto the 2Fo-Fc isosurface via the external-volume color theme.
// Nothing here forks Mol*; it is composition of existing primitives.

export const TWO_FOFC_COLOR = 0x3362b2;
export const FOFC_POS_COLOR = 0x33bb33;
export const FOFC_NEG_COLOR = 0xbb3333;

export interface DensityVolumes {
  /** state refs of the Volume.Data cells */
  twoFoFc: string | null;
  foFc: string | null;
}

export interface DensityReprs {
  twoFoFc: string | null;
  foFcPos: string | null;
  foFcNeg: string | null;
}

// --- structure factors to volumes (client-side FFT) ---

export async function loadStructureFactors(
  ctx: PluginContext,
  data: string | Uint8Array,
  opts: { entryId?: string; label?: string } = {},
): Promise<DensityVolumes> {
  const provider = ctx.dataFormats.get("sfcif");
  if (!provider) throw new Error("No 'sfcif' data format provider; molstar >= 5.11 required.");
  const raw = await ctx.builders.data.rawData(
    { data: data as string, label: opts.label ?? "structure factors" },
    { state: { isGhost: true } },
  );
  const parsed = (await provider.parse(ctx, raw, { entryId: opts.entryId })) as {
    volumes?: { "2fofc"?: { ref: string }[]; fofc?: { ref: string }[] };
  };
  return {
    twoFoFc: parsed.volumes?.["2fofc"]?.[0]?.ref ?? null,
    foFc: parsed.volumes?.fofc?.[0]?.ref ?? null,
  };
}

// --- isosurfaces (mirrors the dynamic-pdb StructureViewer parameters) ---

export async function buildIsosurfaces(ctx: PluginContext, vols: DensityVolumes): Promise<DensityReprs> {
  const tree = ctx.build();
  const refs: DensityReprs = { twoFoFc: null, foFcPos: null, foFcNeg: null };

  if (vols.twoFoFc) {
    refs.twoFoFc = tree
      .to(vols.twoFoFc)
      .apply(
        StateTransforms.Representation.VolumeRepresentation3D,
        VolumeRepresentation3DHelpers.getDefaultParamsStatic(
          ctx,
          "isosurface",
          { isoValue: Volume.IsoValue.relative(1.5), alpha: 0.5 },
          "uniform",
          { value: Color(TWO_FOFC_COLOR) },
        ),
      ).selector.ref;
  }
  if (vols.foFc) {
    refs.foFcPos = tree
      .to(vols.foFc)
      .apply(
        StateTransforms.Representation.VolumeRepresentation3D,
        VolumeRepresentation3DHelpers.getDefaultParamsStatic(
          ctx,
          "isosurface",
          { isoValue: Volume.IsoValue.relative(3), alpha: 0.6 },
          "uniform",
          { value: Color(FOFC_POS_COLOR) },
        ),
      ).selector.ref;
    refs.foFcNeg = tree
      .to(vols.foFc)
      .apply(
        StateTransforms.Representation.VolumeRepresentation3D,
        VolumeRepresentation3DHelpers.getDefaultParamsStatic(
          ctx,
          "isosurface",
          { isoValue: Volume.IsoValue.relative(-3), alpha: 0.6 },
          "uniform",
          { value: Color(FOFC_NEG_COLOR) },
        ),
      ).selector.ref;
  }
  await tree.commit();
  return refs;
}

export async function updateIsoSigma(ctx: PluginContext, reprRef: string, sigma: number): Promise<void> {
  await ctx
    .build()
    .to(reprRef)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update((old: any) => {
      old.type.params.isoValue = Volume.IsoValue.relative(sigma);
    })
    .commit();
}

// --- clip sphere: keep only density within `radius` A of a point ---
// Clip objects are unit shapes scaled by `scale`; the shader treats scale as the
// diameter (sphereSD uses scale * 0.5), and invert keeps the inside.

function clipSphereObjects(center: Vec3, radius: number) {
  return [
    {
      type: "sphere" as const,
      invert: true,
      position: Vec3.clone(center),
      rotation: { axis: Vec3.create(1, 0, 0), angle: 0 },
      scale: Vec3.create(2 * radius, 2 * radius, 2 * radius),
      transform: Mat4.identity(),
    },
  ];
}

export async function setClipSphere(
  ctx: PluginContext,
  reprRefs: (string | null)[],
  center: [number, number, number],
  radius: number,
): Promise<void> {
  const c = Vec3.create(center[0], center[1], center[2]);
  const tree = ctx.build();
  for (const ref of reprRefs) {
    if (!ref) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tree.to(ref).update((old: any) => {
      old.type.params.clip = { variant: "instance", objects: clipSphereObjects(c, radius) };
    });
  }
  await tree.commit();
}

export async function clearClip(ctx: PluginContext, reprRefs: (string | null)[]): Promise<void> {
  const tree = ctx.build();
  for (const ref of reprRefs) {
    if (!ref) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tree.to(ref).update((old: any) => {
      old.type.params.clip = { variant: "instance", objects: [] };
    });
  }
  await tree.commit();
}

// --- arbitrary-plane slice through a point ---

export async function createSlice(
  ctx: PluginContext,
  volumeRef: string,
  point: [number, number, number],
  normal: [number, number, number],
): Promise<string> {
  const params = VolumeRepresentation3DHelpers.getDefaultParamsStatic(ctx, "slice", {}, "volume-value");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (params.type.params as any).mode = "plane";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (params.type.params as any).plane = {
    point: Vec3.create(point[0], point[1], point[2]),
    normal: Vec3.create(normal[0], normal[1], normal[2]),
  };
  const selector = await ctx
    .build()
    .to(volumeRef)
    .apply(StateTransforms.Representation.VolumeRepresentation3D, params)
    .commit();
  return selector.ref;
}

export async function updateSlice(
  ctx: PluginContext,
  sliceRef: string,
  point: [number, number, number],
  normal: [number, number, number],
): Promise<void> {
  await ctx
    .build()
    .to(sliceRef)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update((old: any) => {
      old.type.params.mode = "plane";
      old.type.params.plane = {
        point: Vec3.create(point[0], point[1], point[2]),
        normal: Vec3.create(normal[0], normal[1], normal[2]),
      };
    })
    .commit();
}

export async function removeNode(ctx: PluginContext, ref: string): Promise<void> {
  await ctx.build().delete(ref).commit();
}

// --- metric field as an in-memory Volume (alpha-orbitals pattern) ---

export interface MetricPoint {
  x: number;
  y: number;
  z: number;
  value: number;
}

// Gaussian-weighted average of point values on a regular cartesian grid.
// Voxels farther than `radius` from every point stay at 0.
function buildMetricGrid(points: MetricPoint[], spacing: number, radius: number) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  const margin = radius + 1;
  minX -= margin; minY -= margin; minZ -= margin;
  maxX += margin; maxY += margin; maxZ += margin;

  const nx = Math.max(2, Math.ceil((maxX - minX) / spacing) + 1);
  const ny = Math.max(2, Math.ceil((maxY - minY) / spacing) + 1);
  const nz = Math.max(2, Math.ceil((maxZ - minZ) / spacing) + 1);

  const space = Tensor.Space([nx, ny, nz], [0, 1, 2], Float32Array);
  const wv = new Float32Array(nx * ny * nz);
  const w = new Float32Array(nx * ny * nz);
  const sigma = radius / 2;
  const inv2s2 = 1 / (2 * sigma * sigma);
  const reach = Math.ceil(radius / spacing);

  for (const p of points) {
    const gi = Math.round((p.x - minX) / spacing);
    const gj = Math.round((p.y - minY) / spacing);
    const gk = Math.round((p.z - minZ) / spacing);
    for (let i = Math.max(0, gi - reach); i <= Math.min(nx - 1, gi + reach); i++) {
      const dx = minX + i * spacing - p.x;
      for (let j = Math.max(0, gj - reach); j <= Math.min(ny - 1, gj + reach); j++) {
        const dy = minY + j * spacing - p.y;
        for (let k = Math.max(0, gk - reach); k <= Math.min(nz - 1, gk + reach); k++) {
          const dz = minZ + k * spacing - p.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > radius * radius) continue;
          const g = Math.exp(-d2 * inv2s2);
          const idx = (i * ny + j) * nz + k;
          wv[idx] += g * p.value;
          w[idx] += g;
        }
      }
    }
  }

  const data = new Float32Array(nx * ny * nz);
  let min = Infinity, max = -Infinity, sum = 0;
  for (let idx = 0; idx < data.length; idx++) {
    const v = w[idx] > 1e-6 ? wv[idx] / w[idx] : 0;
    data[idx] = v;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / data.length;
  let varSum = 0;
  for (let idx = 0; idx < data.length; idx++) {
    const d = data[idx] - mean;
    varSum += d * d;
  }

  const matrix = Mat4.identity();
  Mat4.setValue(matrix, 0, 0, spacing);
  Mat4.setValue(matrix, 1, 1, spacing);
  Mat4.setValue(matrix, 2, 2, spacing);
  Mat4.setValue(matrix, 0, 3, minX);
  Mat4.setValue(matrix, 1, 3, minY);
  Mat4.setValue(matrix, 2, 3, minZ);

  return {
    transform: { kind: "matrix" as const, matrix },
    cells: Tensor.create(space, Tensor.Data1(data)),
    stats: { min, max, mean, sigma: Math.sqrt(varSum / data.length) },
  };
}

const CreateMetricVolume = PluginStateTransform.BuiltIn({
  name: "hetkit-metric-volume",
  display: { name: "Metric Volume", description: "A per-atom metric splatted onto a cartesian grid." },
  from: SO.Root,
  to: SO.Volume.Data,
  params: {
    points: PD.Value<MetricPoint[]>([], { isHidden: true }),
    spacing: PD.Numeric(1.0, { min: 0.25, max: 4, step: 0.25 }),
    radius: PD.Numeric(2.0, { min: 0.5, max: 6, step: 0.5 }),
    label: PD.Text("Metric field"),
  },
})({
  apply({ params }) {
    return Task.create("Metric Volume", async () => {
      if (!params.points.length) throw new Error("no metric points");
      const grid = buildMetricGrid(params.points, params.spacing, params.radius);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const volume: any = {
        grid,
        instances: [{ transform: Mat4.identity() }],
        sourceData: { kind: "hetkit-metric", name: params.label, data: params.points },
        customProperties: new CustomProperties(),
        _propertyData: Object.create(null),
        _localPropertyData: Object.create(null),
      };
      return new SO.Volume.Data(volume, { label: params.label });
    });
  },
});

export async function createMetricVolume(
  ctx: PluginContext,
  points: MetricPoint[],
  opts: { spacing?: number; radius?: number; label?: string } = {},
): Promise<string> {
  const selector = await ctx
    .build()
    .toRoot()
    .apply(CreateMetricVolume, {
      points,
      spacing: opts.spacing ?? 1,
      radius: opts.radius ?? 2,
      label: opts.label ?? "Metric field",
    })
    .commit();
  return selector.ref;
}

// --- project a metric volume onto a density representation ---
// external-volume colors per VERTEX by trilinearly sampling any Volume in the state
// tree, so pointing it at the metric volume paints the 2Fo-Fc isosurface by the metric.

export async function colorReprByVolume(
  ctx: PluginContext,
  reprRef: string,
  volumeRef: string,
  domain: [number, number],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const themeParams: any = PD.getDefaultValues(ExternalVolumeColorThemeParams);
  themeParams.volume = PD.Ref(volumeRef);
  themeParams.coloring = {
    name: "absolute-value",
    params: { ...themeParams.coloring.params, domain: { name: "custom", params: domain } },
  };
  await ctx
    .build()
    .to(reprRef)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update((old: any) => {
      old.colorTheme = { name: "external-volume", params: themeParams };
    })
    .commit();
}

export async function colorReprUniform(ctx: PluginContext, reprRef: string, color: number): Promise<void> {
  const defaults = VolumeRepresentation3DHelpers.getDefaultParamsStatic(ctx, "isosurface", {}, "uniform", {
    value: Color(color),
  });
  await ctx
    .build()
    .to(reprRef)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update((old: any) => {
      old.colorTheme = defaults.colorTheme;
    })
    .commit();
}
