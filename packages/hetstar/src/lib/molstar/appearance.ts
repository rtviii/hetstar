import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";
import { createStructureRepresentationParams } from "molstar/lib/mol-plugin-state/helpers/structure-representation-params";
import { clearStructureOverpaint } from "molstar/lib/mol-plugin-state/helpers/structure-overpaint";
import {
  clearStructureTransparency,
  setStructureTransparency,
} from "molstar/lib/mol-plugin-state/helpers/structure-transparency";
import {
  applyConformerStyling,
  componentsForStructure,
  isBondsComponent,
  isLocusComponent,
  isOverlayComponent,
  isSideChainsComponent,
  representationRefsForStructure,
  SIDE_CHAINS_TAG,
  type ConformerPlan,
} from "./conformers";
import { removeNode, setReprsPickable, type ClipObjectSpec } from "./density";
import { buildSideChainQuery, structureToLoci } from "./queries";
import {
  applyRepStyle,
  BORN_HIDDEN,
  componentRole,
  reprSpecForRole,
  repTypeOfKind,
  SELREP_BALLSTICK_SIZE,
  type RepColorMode,
  type RepKind,
  type RepStyle,
} from "./repstyle";
import { TRACK_THEME_NAME, type TrackPaint } from "./track-theme";

// How a whole model looks: what its polymer is drawn as, whether its ligands and ions show,
// and what it is painted with. One function applies it, to a ghost in the main scene and to
// a replica in the switchboard alike. The main view's own model does not go through here:
// its look is spread over the styling effects of HetstarViewer, which interleave it with the
// conformer tools; it shares syncSideChains and applyModelVisibility with this module.

/** what a model is painted with */
export type ModelPaint =
  | { kind: "ghost" }
  | { kind: "color"; mode: RepColorMode }
  | { kind: "track"; paint: TrackPaint };

export interface ModelLook {
  rep: RepKind;
  het: boolean;
  ions: boolean;
  paint: ModelPaint;
}

type ColorOverride = { color: string; colorParams?: Record<string, unknown> };

/**
 * The side-chain overlay of "cartoon + side chains": made, restyled in place or removed to
 * match `polymerComps` (null: no overlay). Thin sticks at a fixed size, coloured like the
 * polymer they belong to.
 */
export async function syncSideChains(
  ctx: PluginContext,
  structureRef: string,
  polymerComps: readonly string[] | null,
  style: RepStyle,
  opts: { uniformColor: number; ghost?: boolean; colorOverride?: ColorOverride; clip?: ClipObjectSpec[]; hidden?: boolean },
): Promise<void> {
  const existing = componentsForStructure(ctx, structureRef).find(isSideChainsComponent);
  if (!polymerComps || !polymerComps.length) {
    if (existing) await removeNode(ctx, existing.cell.transform.ref);
    return;
  }
  const sticks: RepStyle = { ...style, type: "ball-and-stick", ballStick: { sizeFactor: SELREP_BALLSTICK_SIZE } };
  const base = reprSpecForRole("polymer", sticks, opts);
  const colored = opts.colorOverride ? { ...base, colorParams: undefined, ...opts.colorOverride } : base;
  const spec = { ...colored, typeParams: { ...colored.typeParams, clip: { variant: "pixel", objects: opts.clip ?? [] } } };
  if (existing?.representations.length) {
    const structure = existing.cell.obj?.data;
    if (!structure) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = createStructureRepresentationParams(ctx, structure, spec as any);
    const build = ctx.build();
    for (const representation of existing.representations) build.to(representation.cell.transform.ref).update(params);
    await build.commit();
    if (opts.ghost) setReprsPickable(ctx, existing.representations.map((r) => r.cell.transform.ref), false);
    return;
  }
  const component = await ctx.builders.structure.tryCreateComponentFromExpression(
    structureRef,
    buildSideChainQuery(polymerComps),
    SIDE_CHAINS_TAG,
    { label: "side chains", tags: [SIDE_CHAINS_TAG] },
  );
  if (!component) return;
  const representation = await ctx.builders.structure.representation.addRepresentation(
    component,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spec as any,
    opts.hidden ? BORN_HIDDEN : undefined,
  );
  if (opts.ghost && representation) setReprsPickable(ctx, [representation.ref], false);
}

/**
 * Show or hide a model part by part: the whole of it, and within a shown model its ligands
 * and its ions. Loci and the bond overlay are left alone; they have switches of their own.
 * Run after anything that creates components, which are born visible.
 */
export function applyModelVisibility(
  ctx: PluginContext,
  structureRef: string,
  shown: { visible: boolean; het: boolean; ions: boolean },
): void {
  for (const component of componentsForStructure(ctx, structureRef)) {
    if (isLocusComponent(component) || isBondsComponent(component)) continue;
    const role = componentRole(component);
    const partShown = role === "het" ? shown.het : role === "ion" ? shown.ions : true;
    setSubtreeVisibility(ctx.state.data, component.cell.transform.ref, !(shown.visible && partShown));
  }
}

export interface ModelLookOptions {
  /** the knobs every model shares: mesh quality and the size of each representation type */
  base: RepStyle;
  /** the model's identity colour */
  uniformColor: number;
  /** the comp ids of the model's polymer (the side-chain overlay is cut from them) */
  polymerComps: readonly string[];
  /** which conformer each split residue collapses to */
  plan: ConformerPlan;
  ghostTransparency: number;
  /** a ghost in one flat colour, ligands included (the main scene); otherwise they keep their elements */
  flatGhost: boolean;
  /** false: no pick ever lands on this model (a pick carries no model identity) */
  pickable: boolean;
  clip?: ClipObjectSpec[];
}

/** Apply `look` to an already-built model (its lab components exist). Idempotent. */
export async function applyModelLook(
  ctx: PluginContext,
  structureRef: string,
  look: ModelLook,
  opts: ModelLookOptions,
): Promise<void> {
  const paint = look.paint;
  const type = repTypeOfKind(look.rep);
  const style: RepStyle = {
    ...opts.base,
    type,
    colorMode: paint.kind === "color" ? paint.mode : "model",
  };
  const ghost = paint.kind === "ghost" && opts.flatGhost;
  const colorOverride: ColorOverride | undefined =
    paint.kind === "track" ? { color: TRACK_THEME_NAME, colorParams: { paint: paint.paint } } : undefined;

  await applyRepStyle(ctx, structureRef, style, { uniformColor: opts.uniformColor, ghost, colorOverride });
  await syncSideChains(ctx, structureRef, look.rep === "cartoon-sticks" ? opts.polymerComps : null, style, {
    uniformColor: opts.uniformColor,
    ghost,
    colorOverride,
    clip: opts.clip,
  });

  if (paint.kind === "ghost") {
    const components = componentsForStructure(ctx, structureRef);
    if (components.length) {
      await clearStructureTransparency(ctx, components);
      await clearStructureOverpaint(ctx, components);
      await setStructureTransparency(
        ctx,
        components.filter((c) => !isOverlayComponent(c) || isSideChainsComponent(c)),
        opts.ghostTransparency,
        async (root) => structureToLoci(root),
      );
    }
  } else {
    // collapsed to one conformer per residue, like the main view before anything is expanded
    await applyConformerStyling(ctx, structureRef, opts.plan, {
      shown: new Set(),
      globalAlt: null,
      polymerAsTrace: type === "cartoon",
      polymerFade: paint.kind === "color" && paint.mode === "conformer",
    });
  }
  if (!opts.pickable) setReprsPickable(ctx, representationRefsForStructure(ctx, structureRef), false);
}
