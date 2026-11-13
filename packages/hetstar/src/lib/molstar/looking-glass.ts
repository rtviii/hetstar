import { Mesh } from "molstar/lib/mol-geo/geometry/mesh/mesh";
import { MeshBuilder } from "molstar/lib/mol-geo/geometry/mesh/mesh-builder";
import { addSphere } from "molstar/lib/mol-geo/geometry/mesh/builder/sphere";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { Shape } from "molstar/lib/mol-model/shape";
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { PluginStateObject as SO, PluginStateTransform } from "molstar/lib/mol-plugin-state/objects";
import { StateTransforms } from "molstar/lib/mol-plugin-state/transforms";
import { Task } from "molstar/lib/mol-task";
import { Color } from "molstar/lib/mol-util/color";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { setReprsPickable } from "./density";

// The looking glass of a switchboard box: one translucent sphere marking the part of the
// model the main view is on (its clip sphere, or what its camera frames). Root-parented
// like the bond dashes, and never pickable: clicks belong to the residues inside it.

export interface LookingGlass {
  center: [number, number, number];
  radius: number;
}

export interface LookingGlassRefs {
  provider: string;
  repr: string;
}

const GLASS_COLOR = 0x7d53e7;
const GLASS_ALPHA = 0.22;

const LookingGlassShape = PluginStateTransform.BuiltIn({
  name: "hetstar-looking-glass",
  display: "Looking glass",
  from: SO.Root,
  to: SO.Shape.Provider,
  params: {
    center: PD.Value<[number, number, number]>([0, 0, 0], { isHidden: true }),
    radius: PD.Numeric(1, undefined, { isHidden: true }),
  },
})({
  canAutoUpdate: () => true,
  apply({ params }) {
    return Task.create("Looking glass", async () => {
      return new SO.Shape.Provider(
        {
          label: "Looking glass",
          data: params,
          params: Mesh.Params,
          // Mol* swaps a shape's geometry in place only when the rebuilt mesh reuses the
          // previous one's buffers; a fresh mesh leaves the old sphere on screen
          getShape: (_, data: typeof params, __, previous?: Shape<Mesh>) =>
            Shape.create(
              "looking-glass",
              data,
              buildSphereMesh(data.center, data.radius, previous?.geometry),
              () => Color(GLASS_COLOR),
              () => 1,
              () => "the main view",
            ),
          geometryUtils: Mesh.Utils,
        },
        { label: "Looking glass" },
      );
    });
  },
});

function buildSphereMesh(center: [number, number, number], radius: number, previous?: Mesh): Mesh {
  const state = MeshBuilder.createState(1024, 512, previous);
  state.currentGroup = 0;
  addSphere(state, Vec3.create(center[0], center[1], center[2]), radius, 3);
  return MeshBuilder.getMesh(state);
}

/**
 * Show, move or remove the sphere. An existing node is updated in place; returns the refs
 * in force, or null once the sphere is gone.
 */
export async function ensureLookingGlass(
  ctx: PluginContext,
  prev: LookingGlassRefs | null,
  glass: LookingGlass | null,
): Promise<LookingGlassRefs | null> {
  const alive = prev && ctx.state.data.cells.has(prev.provider) ? prev : null;
  if (!glass) {
    if (alive) await ctx.build().delete(alive.provider).commit();
    return null;
  }
  if (alive) {
    await ctx.build().to(alive.provider).update({ center: glass.center, radius: glass.radius }).commit();
    setReprsPickable(ctx, [alive.repr], false);
    return alive;
  }
  const provider = ctx
    .build()
    .toRoot()
    .apply(LookingGlassShape, { center: glass.center, radius: glass.radius }, { state: { isGhost: true } });
  const repr = provider.apply(StateTransforms.Representation.ShapeRepresentation3D, {
    ignoreLight: true,
    alpha: GLASS_ALPHA,
  });
  await provider.commit();
  setReprsPickable(ctx, [repr.ref], false);
  return { provider: provider.ref, repr: repr.ref };
}
