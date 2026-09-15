import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { StructureComponentRef } from "molstar/lib/mol-plugin-state/manager/structure/hierarchy-state";
import { createStructureRepresentationParams } from "molstar/lib/mol-plugin-state/helpers/structure-representation-params";
import { Color } from "molstar/lib/mol-util/color";
import { isHeavy, isPolymerComp, type AtomTable } from "@dynamic-pdb/hetkit/model";
import { WATER_COMPS } from "../lab/entries";
import { componentsForStructure, isOverlayComponent } from "./conformers";
import { setReprsPickable } from "./density";
import { buildComponentQuery, mergeExpressions } from "./queries";

// Live representation styling for the viewer: switch the representation type, size
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
//
// Components are chemistry-driven, not entity-driven: qFit CIFs carry no _entity
// category, so Mol*'s static "polymer"/"ligand" components fold ligands like GDP into
// the polymer. compSplitFromTable splits the comp ids of the atom table instead, and
// ensureLabComponents rebuilds the structure's components from expressions, tagged
// lab-polymer / lab-het / lab-ion so applyRepStyle knows each component's role.

export type RepType = "ball-and-stick" | "spacefill" | "cartoon";
export type RepColorMode = "model" | "element" | "chain";
export type RepQuality = "auto" | "high" | "medium" | "low";

export interface RepStyle {
  type: RepType;
  colorMode: RepColorMode;
  quality: RepQuality;
  ballStick: { sizeFactor: number };
  spacefill: { sizeFactor: number };
  cartoon: { sizeFactor: number };
}

/** Mol* defaults for each representation's size params (the sliders' resting values). */
export const DEFAULT_REP_STYLE: RepStyle = {
  type: "ball-and-stick",
  colorMode: "model",
  quality: "auto",
  ballStick: { sizeFactor: 0.15 },
  spacefill: { sizeFactor: 1 },
  cartoon: { sizeFactor: 0.2 },
};

// Fixed shape params that used to be user sliders.
const BALL_STICK_SIZE_ASPECT_RATIO = 2 / 3;
const CARTOON_ASPECT_RATIO = 5;
/** ions render as small spheres regardless of the polymer's spacefill scale */
const ION_SIZE_FACTOR = 0.35;
/** per-selection representation overrides: fixed sizes, deliberately far below the
 * global spacefill default (vdW-scale 1.0 swallows the neighborhood) */
export const SELREP_SPACEFILL_SIZE = 0.4;
export const SELREP_BALLSTICK_SIZE = 0.22;

export type LabRole = "polymer" | "het" | "ion";
const LAB_TAG: Record<LabRole, string> = { polymer: "lab-polymer", het: "lab-het", ion: "lab-ion" };

export interface CompSplit {
  polymer: string[];
  het: string[];
  ions: string[];
}

/**
 * Split the table's comp ids by chemistry: polymer comps (one-letter code known),
 * ions (single heavy atom per residue) and het (everything else — GDP, QWB). Waters
 * are dropped entirely.
 */
export function compSplitFromTable(table: AtomTable): CompSplit {
  const polymer = new Set<string>();
  // max distinct heavy atom names per residue of each non-polymer comp: 1 = ion
  // (distinct names, so altloc-duplicated ion atoms still count once)
  const maxHeavy = new Map<string, number>();
  for (const res of table.residues) {
    const comp = res.compId;
    if (WATER_COMPS.has(comp)) continue;
    if (isPolymerComp(comp)) {
      polymer.add(comp);
      continue;
    }
    const names = new Set<string>();
    for (const r of res.rows) if (isHeavy(table, r)) names.add(table.atomName[r]);
    maxHeavy.set(comp, Math.max(maxHeavy.get(comp) ?? 0, names.size));
  }
  const het: string[] = [];
  const ions: string[] = [];
  for (const [comp, n] of maxHeavy) (n <= 1 ? ions : het).push(comp);
  return { polymer: [...polymer].sort(), het: het.sort(), ions: ions.sort() };
}

function componentKind(c: StructureComponentRef): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (c.cell.transform.params as any)?.type;
  return t?.name === "static" ? (t.params as string) : null;
}

function componentRole(c: StructureComponentRef): LabRole | null {
  const tags = c.cell.transform.tags;
  if (!tags) return null;
  if (tags.includes(LAB_TAG.polymer)) return "polymer";
  if (tags.includes(LAB_TAG.het)) return "het";
  if (tags.includes(LAB_TAG.ion)) return "ion";
  return null;
}

function typeParamsFor(type: RepType, style: RepStyle) {
  return type === "ball-and-stick"
    ? {
        ignoreLight: true,
        quality: style.quality,
        sizeFactor: style.ballStick.sizeFactor,
        sizeAspectRatio: BALL_STICK_SIZE_ASPECT_RATIO,
      }
    : type === "spacefill"
      ? { ignoreLight: true, quality: style.quality, sizeFactor: style.spacefill.sizeFactor }
      : {
          ignoreLight: true,
          quality: style.quality,
          sizeFactor: style.cartoon.sizeFactor,
          aspectRatio: CARTOON_ASPECT_RATIO,
        };
}

// carbons keep the model identity color; heteroatoms read CPK
const elementWithCarbon = (uniformColor: number) => ({
  color: "element-symbol" as const,
  // colorParams are shallow-merged into the theme defaults, so the nested uniform
  // params must be complete: missing saturation/lightness NaN out to black
  colorParams: {
    carbonColor: {
      name: "uniform" as const,
      params: { value: Color(uniformColor), saturation: 0, lightness: 0 },
    },
  },
});
const uniformOnly = (uniformColor: number) => ({
  color: "uniform" as const,
  colorParams: { value: Color(uniformColor) },
});

/**
 * Representation props for one component role under `style`:
 *  - polymer: the active type + its size; color follows colorMode.
 *  - het: always ball-and-stick, always element-symbol with the model's carbon color —
 *    visible and identifiable under every polymer mode.
 *  - ion: spacefill at a small fixed size, element-symbol color.
 * Ghosts render uniform in their own color regardless of role (type and size still
 * follow the role rules so the silhouette matches the primary).
 */
export function reprSpecForRole(role: LabRole, style: RepStyle, opts: { uniformColor: number; ghost?: boolean }) {
  const type: RepType = role === "ion" ? "spacefill" : role === "het" ? "ball-and-stick" : style.type;
  const typeParams =
    role === "ion"
      ? { ignoreLight: true, quality: style.quality, sizeFactor: ION_SIZE_FACTOR }
      : typeParamsFor(type, style);
  const color = opts.ghost
    ? uniformOnly(opts.uniformColor)
    : role === "het"
      ? elementWithCarbon(opts.uniformColor)
      : role === "ion"
        ? { color: "element-symbol" as const }
        : style.colorMode === "element"
          ? elementWithCarbon(opts.uniformColor)
          : style.colorMode === "chain"
            ? { color: "chain-id" as const }
            : uniformOnly(opts.uniformColor);
  return { type, typeParams, ...color };
}

// Untagged (static) components — other screens, or the window before the expression
// components replace the initial build: the old behavior. Cartoon has no meaning on
// isolated ligands/ions, so under cartoon the non-polymer components keep
// ball-and-stick; color follows colorMode.
function reprSpecLegacy(kind: string | null, style: RepStyle, opts: { uniformColor: number; ghost?: boolean }) {
  const type = style.type === "cartoon" && kind !== "polymer" ? "ball-and-stick" : style.type;
  const colorMode = opts.ghost ? "model" : style.colorMode;
  const color =
    colorMode === "element"
      ? elementWithCarbon(opts.uniformColor)
      : colorMode === "chain"
        ? { color: "chain-id" as const }
        : uniformOnly(opts.uniformColor);
  return { type, typeParams: typeParamsFor(type, style), ...color };
}

/**
 * Replace the structure's components with the three chemistry components of `split`
 * (skipping empty groups) and add one representation per component using the role
 * rules. The conformer/selection layers on the old components die with them — callers
 * re-assert those downstream (the panel's effect order guarantees it).
 */
export async function ensureLabComponents(
  ctx: PluginContext,
  structureRef: string,
  split: CompSplit,
  style: RepStyle,
  opts: { uniformColor: number; ghost?: boolean },
): Promise<void> {
  // create the new components before deleting the old ones: if anything in the
  // create loop fails, the previous components stay on screen instead of nothing.
  // The app overlays (lab-bonds, lab-selrep) are not chemistry components — they
  // survive the rebuild and their owner effects manage their lifecycles.
  const existing = componentsForStructure(ctx, structureRef).filter((c) => !isOverlayComponent(c));
  const existingRefs = new Set(existing.map((c) => c.cell.transform.ref));
  const groups: { role: LabRole; comps: string[] }[] = [
    { role: "polymer", comps: split.polymer },
    { role: "het", comps: split.het },
    { role: "ion", comps: split.ions },
  ];
  const reprRefs: string[] = [];
  // Mol*'s tryCreateComponentFromExpression applyOrUpdateTagged-s by key: on a re-run
  // for the same structure (Fast Refresh re-running the owner effect, a comp-split
  // drift) the "created" component is the SAME node updated in place — deleting the
  // `existing` list wholesale then nuked every chemistry component, leaving only the
  // overlays on screen. Track what this run (re)used and delete only true leftovers;
  // a reused component keeps its representation (the style pass owns its params).
  const created = new Set<string>();
  for (const g of groups) {
    if (!g.comps.length) continue;
    const tag = LAB_TAG[g.role];
    const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
      structureRef,
      mergeExpressions(g.comps.map(buildComponentQuery)),
      tag,
      { label: g.comps.join(", "), tags: [tag] },
    );
    if (!comp) continue;
    created.add(comp.ref);
    if (existingRefs.has(comp.ref)) continue; // updated in place; repr already there
    const repr = await ctx.builders.structure.representation.addRepresentation(
      comp,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reprSpecForRole(g.role, style, opts) as any,
    );
    if (repr) reprRefs.push(repr.ref);
  }
  const stale = existing.filter((c) => !created.has(c.cell.transform.ref));
  if (stale.length) {
    const del = ctx.build();
    for (const c of stale) del.delete(c.cell.transform.ref);
    await del.commit();
  }
  if (opts.ghost) setReprsPickable(ctx, reprRefs, false);
}

/**
 * Apply `style` to every representation of the structure's components, deriving each
 * component's role from its lab tag (static-kind fallback for untagged components).
 * Ghosts always render uniform in their own color (only type, size and quality follow
 * the primary) and are kept non-pickable across the recreate.
 */
export async function applyRepStyle(
  ctx: PluginContext,
  structureRef: string,
  style: RepStyle,
  opts: { uniformColor: number; ghost?: boolean },
): Promise<void> {
  // the app overlays keep their own representations regardless of style
  const comps = componentsForStructure(ctx, structureRef).filter((c) => !isOverlayComponent(c));
  if (!comps.length) return;

  const build = ctx.build();
  const reprRefs: string[] = [];
  for (const c of comps) {
    const structure = c.cell.obj?.data;
    if (!structure) continue;
    const role = componentRole(c);
    const spec = role ? reprSpecForRole(role, style, opts) : reprSpecLegacy(componentKind(c), style, opts);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = createStructureRepresentationParams(ctx, structure, spec as any);
    for (const r of c.representations) {
      build.to(r.cell.transform.ref).update(params);
      reprRefs.push(r.cell.transform.ref);
    }
  }
  await build.commit();
  if (opts.ghost) setReprsPickable(ctx, reprRefs, false);
}
