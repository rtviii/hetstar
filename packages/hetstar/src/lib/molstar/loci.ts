import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";
import { Color } from "molstar/lib/mol-util/color";
import { removeNode, setReprsPickable } from "./density";
import { selectionExpression } from "./queries";
import {
  BALL_STICK_SIZE_ASPECT_RATIO,
  elementWithCarbon,
  NO_HYDROGENS,
  SELREP_BALLSTICK_SIZE,
  type RepQuality,
} from "./repstyle";

// The 3D side of a locus: a component of its own over the selected atoms, tagged so the
// rep-style pass, the chemistry rebuild and the conformer layers all leave it alone. It
// holds sticks in the locus's colour and, when asked for, the locus's mask as a faint
// shell: a sphere of the mask radius around every heavy atom, whose union is the set of
// points the model's RSCC is taken over there.

export const LOCUS_TAG = "lab-locus";

export interface LocusComponent {
  id: string;
  selection: {
    ranges: readonly { chain: string; from: number; to: number }[];
    atoms: readonly { chain: string; seq: number; atom: string }[];
  };
  color: number;
  visible: boolean;
  maskShown: boolean;
}

/** the state-tree nodes of each locus, by locus id; owned by the caller, updated here */
export type LocusNodes = Map<string, { component: string; sticks: string; mask: string | null }>;

const MASK_ALPHA = 0.16;

/** Bring the structure's locus components in line with `loci`: gone loci are removed, new
 * ones built, and visibility follows each locus's flags. A locus whose nodes died with a
 * rebuild of the tree is built again. */
export async function syncLocusComponents(
  ctx: PluginContext,
  structureRef: string,
  nodes: LocusNodes,
  loci: readonly LocusComponent[],
  opts: { quality: RepQuality; maskRadius: number },
): Promise<void> {
  const alive = (ref: string) => ctx.state.data.cells.has(ref);
  for (const [id, node] of [...nodes]) {
    if (alive(node.component) && loci.some((locus) => locus.id === id)) continue;
    if (alive(node.component)) await removeNode(ctx, node.component);
    nodes.delete(id);
  }
  for (const locus of loci) {
    let node = nodes.get(locus.id);
    if (!node) {
      const expression = selectionExpression(locus.selection);
      if (!expression) continue;
      const component = await ctx.builders.structure.tryCreateComponentFromExpression(
        structureRef,
        expression,
        `lab-locus-${locus.id}`,
        { label: "locus", tags: [LOCUS_TAG] },
      );
      if (!component) continue;
      const sticks = await ctx.builders.structure.representation.addRepresentation(component, {
        type: "ball-and-stick",
        typeParams: {
          ignoreLight: true,
          ...NO_HYDROGENS,
          quality: opts.quality,
          sizeFactor: SELREP_BALLSTICK_SIZE,
          sizeAspectRatio: BALL_STICK_SIZE_ASPECT_RATIO,
        },
        ...elementWithCarbon(locus.color),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      node = { component: component.ref, sticks: sticks.ref, mask: null };
      nodes.set(locus.id, node);
    }
    if (locus.maskShown && !node.mask) {
      const mask = await ctx.builders.structure.representation.addRepresentation(node.component, {
        type: "spacefill",
        typeParams: { ignoreLight: true, ...NO_HYDROGENS, quality: opts.quality, sizeFactor: 1, alpha: MASK_ALPHA },
        color: "uniform",
        colorParams: { value: Color(locus.color) },
        size: "uniform",
        sizeParams: { value: opts.maskRadius },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      node.mask = mask.ref;
      // the shell must not take the clicks meant for the atoms inside it
      setReprsPickable(ctx, [mask.ref], false);
    }
    setSubtreeVisibility(ctx.state.data, node.sticks, !locus.visible);
    if (node.mask) setSubtreeVisibility(ctx.state.data, node.mask, !(locus.visible && locus.maskShown));
  }
}
