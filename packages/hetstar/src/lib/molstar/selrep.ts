import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { ResidueRange } from "./conformers";
import { removeNode } from "./density";
import { buildResidueQuery, mergeExpressions } from "./queries";
import {
  reprSpecForRole,
  SELREP_BALLSTICK_SIZE,
  SELREP_SPACEFILL_SIZE,
  type RepStyle,
  type RepType,
} from "./repstyle";

/** a representation override on a residue set, keyed by the serialized ranges it was made from */
export interface SelRepOverlay {
  key: string;
  ranges: ResidueRange[];
  type: RepType;
}

/**
 * Rebuild the structure's lab-selrep components to match `overlays`: the previous ones
 * (tracked in `refs`, which this updates) are removed and each overlay gets a component
 * with one representation of its type. Sizes are fixed: the global spacefill default
 * (vdW 1.0) swallows the scene.
 */
export async function syncSelRepOverlays(
  ctx: PluginContext,
  structureRef: string,
  refs: Map<string, string>,
  overlays: readonly SelRepOverlay[],
  style: RepStyle,
  opts: { uniformColor: number },
): Promise<void> {
  for (const ref of refs.values()) {
    try {
      await removeNode(ctx, ref);
    } catch {
      // died with a tree rebuild
    }
  }
  refs.clear();
  for (const overlay of overlays) {
    const expressions = overlay.ranges.map((r) => buildResidueQuery(r.chain, r.from, r.to === r.from ? undefined : r.to));
    const component = await ctx.builders.structure.tryCreateComponentFromExpression(
      structureRef,
      mergeExpressions(expressions),
      `lab-selrep-${overlay.key}`,
      { label: "selection representation", tags: ["lab-selrep"] },
    );
    if (!component) continue;
    refs.set(overlay.key, component.ref);
    const overlayStyle: RepStyle = {
      ...style,
      type: overlay.type,
      spacefill: { sizeFactor: SELREP_SPACEFILL_SIZE },
      ballStick: { sizeFactor: SELREP_BALLSTICK_SIZE },
    };
    await ctx.builders.structure.representation.addRepresentation(
      component,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reprSpecForRole("polymer", overlayStyle, opts) as any,
    );
  }
}
