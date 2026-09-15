import { addCylinder } from "molstar/lib/mol-geo/geometry/mesh/builder/cylinder";
import { Mesh } from "molstar/lib/mol-geo/geometry/mesh/mesh";
import { MeshBuilder } from "molstar/lib/mol-geo/geometry/mesh/mesh-builder";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { Shape } from "molstar/lib/mol-model/shape";
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { PluginStateObject as SO, PluginStateTransform } from "molstar/lib/mol-plugin-state/objects";
import { StateTransforms } from "molstar/lib/mol-plugin-state/transforms";
import { Task } from "molstar/lib/mol-task";
import { Color } from "molstar/lib/mol-util/color";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { ALT_SHARED_COLOR } from "./altloc-theme";
import { setReprsPickable, type ClipObjectSpec } from "./density";

// App-drawn bond dashes: a custom Shape of dashed cylinders between exactly the endpoints
// computeBonds() produced, replacing Mol*'s interactions representation (which also drew
// contacts to never-rendered waters, and whose parentDisplay:"full" path suppresses most
// intra-unit dashes through a members/offsets indexing bug in molstar 5.11).

/** one dashed cylinder: world-space endpoints + resolved color + hover label */
export interface BondDash {
  start: [number, number, number];
  end: [number, number, number];
  color: number;
  label: string;
}

const DASH_RADIUS = 0.045;
/** target dash+gap pitch, Å */
const DASH_PITCH = 0.25;

// module-level transformer; a duplicate registration under Fast Refresh only warns
const BondDashesShape = PluginStateTransform.BuiltIn({
  name: "hetstar-bond-dashes",
  display: "Bond dashes",
  from: SO.Root,
  to: SO.Shape.Provider,
  params: {
    dashes: PD.Value<BondDash[]>([], { isHidden: true }),
    radius: PD.Numeric(DASH_RADIUS, undefined, { isHidden: true }),
  },
})({
  canAutoUpdate: () => true,
  apply({ params }) {
    return Task.create("Bond dashes", async () => {
      return new SO.Shape.Provider(
        {
          label: "Bond dashes",
          data: params,
          params: Mesh.Params,
          getShape: (_, data: typeof params) =>
            Shape.create(
              "bond-dashes",
              data,
              buildDashMesh(data.dashes, data.radius),
              (g) => Color(data.dashes[g]?.color ?? ALT_SHARED_COLOR),
              () => 1,
              (g) => data.dashes[g]?.label ?? "",
            ),
          geometryUtils: Mesh.Utils,
        },
        { label: "Bond dashes" },
      );
    });
  },
});

function buildDashMesh(dashes: BondDash[], radius: number): Mesh {
  const state = MeshBuilder.createState(512, 256);
  const a = Vec3();
  const b = Vec3();
  const p = Vec3();
  const q = Vec3();
  const props = { radiusTop: radius, radiusBottom: radius, radialSegments: 12 };
  for (let i = 0; i < dashes.length; i++) {
    state.currentGroup = i; // group == dash index -> per-dash color/label
    Vec3.fromArray(a, dashes[i].start, 0);
    Vec3.fromArray(b, dashes[i].end, 0);
    // odd slot count, dashes on even slots: full-length dashes land on both ends
    // (Mol*'s addFixedCountDashedCylinder leaves a gap at the start, being meant for halves)
    const n = Math.max(3, 2 * Math.round(Vec3.distance(a, b) / (2 * DASH_PITCH)) + 1);
    for (let k = 0; k < n; k += 2) {
      Vec3.lerp(p, a, b, k / n);
      Vec3.lerp(q, a, b, (k + 1) / n);
      addCylinder(state, p, q, 1, props);
    }
  }
  return MeshBuilder.getMesh(state);
}

export interface BondDashRefs {
  /** provider node under the root; deleting it removes the representation too */
  provider: string;
  repr: string;
}

/**
 * Replace the single dash node under the state-tree root. Returns the new refs, or null
 * when `dashes` is empty (node removed). Root-parented, so it survives chemistry rebuilds
 * and dies with viewer.clear(); callers run this inside the styling serializer. `clip`:
 * the model clip objects currently in force, so a rebuild during an isolate/slice stays cut.
 */
export async function ensureBondDashes(
  ctx: PluginContext,
  prev: BondDashRefs | null,
  dashes: BondDash[],
  clipObjects: ClipObjectSpec[],
): Promise<BondDashRefs | null> {
  if (prev) {
    try {
      await ctx.build().delete(prev.provider).commit();
    } catch {
      // already gone with the tree (viewer.clear / entry switch)
    }
  }
  if (!dashes.length) return null;
  const provider = ctx
    .build()
    .toRoot()
    .apply(BondDashesShape, { dashes, radius: DASH_RADIUS }, { state: { isGhost: true } });
  const repr = provider.apply(StateTransforms.Representation.ShapeRepresentation3D, {
    ignoreLight: true,
    clip: { variant: "pixel", objects: clipObjects },
  });
  await provider.commit();
  // decoration only: a dash pick would read as a background click in pickFromLoci
  setReprsPickable(ctx, [repr.ref], false);
  return { provider: provider.ref, repr: repr.ref };
}

/** Clip update for the dash repr: shape reprs keep flat Mesh params (no type.params). */
export async function setBondDashesClip(
  ctx: PluginContext,
  refs: BondDashRefs | null,
  clipObjects: ClipObjectSpec[],
): Promise<void> {
  if (!refs || !ctx.state.data.cells.has(refs.repr)) return;
  await ctx
    .build()
    .to(refs.repr)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update((old: any) => {
      old.clip = { variant: "pixel", objects: clipObjects };
    })
    .commit();
  setReprsPickable(ctx, [refs.repr], false);
}
