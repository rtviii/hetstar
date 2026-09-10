import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { StructureComponentRef } from "molstar/lib/mol-plugin-state/manager/structure/hierarchy-state";
import { createStructureRepresentationParams } from "molstar/lib/mol-plugin-state/helpers/structure-representation-params";
import { Color } from "molstar/lib/mol-util/color";
import { componentsForStructure } from "./conformers";
import { setReprsPickable } from "./density";

// Live representation styling for the compare lab: switch the representation type, size
// params, color mode and mesh quality of an ALREADY-BUILT structure via in-place state
// tree updates. Never route style through MolstarViewer's `view` prop — its load effect
// keys on the serialized view and a change there clears the whole tree, density included.
//
// A type switch makes the state engine recreate the representation object AT THE SAME
// REF, so the conformer overpaint/transparency layers (child transforms of the repr
// node) survive and re-run. Two things do NOT survive and are handled here or by the
// caller: per-instance repr state (pickable — re-asserted below for ghosts) and the
// clip objects, which live in type.params and are wiped by a full-params update (the
// panel's clip effect re-applies them by depending on the style state).

export type RepType = "ball-and-stick" | "spacefill" | "cartoon";
export type RepColorMode = "model" | "element" | "chain";
export type RepQuality = "auto" | "high" | "medium" | "low";

export interface RepStyle {
  type: RepType;
  colorMode: RepColorMode;
  quality: RepQuality;
  ballStick: { sizeFactor: number; sizeAspectRatio: number };
  spacefill: { sizeFactor: number };
  cartoon: { sizeFactor: number; aspectRatio: number };
}

/** Mol* defaults for each representation's size params (the sliders' resting values). */
export const DEFAULT_REP_STYLE: RepStyle = {
  type: "ball-and-stick",
  colorMode: "model",
  quality: "auto",
  ballStick: { sizeFactor: 0.15, sizeAspectRatio: 2 / 3 },
  spacefill: { sizeFactor: 1 },
  cartoon: { sizeFactor: 0.2, aspectRatio: 5 },
};

function componentKind(c: StructureComponentRef): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (c.cell.transform.params as any)?.type;
  return t?.name === "static" ? (t.params as string) : null;
}

/**
 * Apply `style` to every representation of the structure's components. Cartoon has no
 * meaning on isolated ligands/ions, so under cartoon the non-polymer components keep
 * ball-and-stick. Ghosts always render uniform in their own color (only type, size and
 * quality follow the primary) and are kept non-pickable across the recreate.
 */
export async function applyRepStyle(
  ctx: PluginContext,
  structureRef: string,
  style: RepStyle,
  opts: { uniformColor: number; ghost?: boolean },
): Promise<void> {
  const comps = componentsForStructure(ctx, structureRef);
  if (!comps.length) return;

  const colorMode = opts.ghost ? "model" : style.colorMode;
  const color =
    colorMode === "element"
      ? {
          color: "element-symbol" as const,
          // carbons keep the model identity color; heteroatoms read CPK
          colorParams: { carbonColor: { name: "uniform" as const, params: { value: Color(opts.uniformColor) } } },
        }
      : colorMode === "chain"
        ? { color: "chain-id" as const }
        : { color: "uniform" as const, colorParams: { value: Color(opts.uniformColor) } };

  const build = ctx.build();
  const reprRefs: string[] = [];
  for (const c of comps) {
    const structure = c.cell.obj?.data;
    if (!structure) continue;
    const kind = componentKind(c);
    const type = style.type === "cartoon" && kind !== "polymer" ? "ball-and-stick" : style.type;
    const typeParams =
      type === "ball-and-stick"
        ? {
            ignoreLight: true,
            quality: style.quality,
            sizeFactor: style.ballStick.sizeFactor,
            sizeAspectRatio: style.ballStick.sizeAspectRatio,
          }
        : type === "spacefill"
          ? { ignoreLight: true, quality: style.quality, sizeFactor: style.spacefill.sizeFactor }
          : {
              ignoreLight: true,
              quality: style.quality,
              sizeFactor: style.cartoon.sizeFactor,
              aspectRatio: style.cartoon.aspectRatio,
            };
    const params = createStructureRepresentationParams(ctx, structure, {
      type,
      typeParams,
      ...color,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    for (const r of c.representations) {
      build.to(r.cell.transform.ref).update(params);
      reprRefs.push(r.cell.transform.ref);
    }
  }
  await build.commit();
  if (opts.ghost) setReprsPickable(ctx, reprRefs, false);
}
