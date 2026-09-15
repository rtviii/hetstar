import { EmptyLoci } from "molstar/lib/mol-model/loci";
import type { Structure } from "molstar/lib/mol-model/structure";
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import type { StructureComponentRef } from "molstar/lib/mol-plugin-state/manager/structure/hierarchy-state";
import {
  clearStructureOverpaint,
  setStructureOverpaint,
} from "molstar/lib/mol-plugin-state/helpers/structure-overpaint";
import {
  clearStructureTransparency,
  setStructureTransparency,
} from "molstar/lib/mol-plugin-state/helpers/structure-transparency";
import { Color } from "molstar/lib/mol-util/color";
import { residueKey, type AltlocResidue, type AltlocSummary } from "@dynamic-pdb/hetkit/model";
import { ALT_FALLBACK_COLOR, AltColors } from "./altloc-theme";
import {
  type AltGroupSelector,
  buildAltGroupExpression,
  executeQuery,
  structureToLoci,
} from "./queries";
import { SECONDARY_TRANSPARENCY } from "./style";

// The collapse engine for the compare lab. One ball-and-stick representation covers
// the whole structure (splitting conformers into components leaves cross-component bonds
// undrawn — side chains float), rendered OPAQUE; everything else is per-loci layers on top:
//   transparency  hidden 1 on the non-kept letters of collapsed altloc residues
//   overpaint     altloc letter colors on expanded residues
// Layers merge with later-shadows-earlier semantics; hidden letters stay hidden because
// transparency 1 wins regardless of any overpaint on the same atoms. Selection is NOT
// painted here — the panel drives Mol*'s selection marker (green tint) instead.
//
// Insertion codes are ignored by the residue expressions (7A1X/9JD2 carry none); revisit
// if an entry with them lands.

export interface ResidueId {
  chain: string;
  seq: number;
  ins?: string;
}

export function residueIdKey(r: ResidueId): string {
  return `${r.chain}|${r.seq}|${r.ins ?? ""}`;
}

export interface ConformerPlan {
  /** residueKey -> the altloc letter kept when the residue is collapsed (highest occupancy) */
  kept: Map<string, string>;
  /** residueKey -> the altloc summary row */
  byKey: Map<string, AltlocResidue>;
}

export function planConformers(summary: AltlocSummary | null): ConformerPlan {
  const kept = new Map<string, string>();
  const byKey = new Map<string, AltlocResidue>();
  if (!summary) return { kept, byKey };
  for (const res of summary.residues) {
    const key = residueKey(res.ref);
    byKey.set(key, res);
    // highest occupancy wins; NaN counts as 0; ties resolve to the first (alphabetical) letter
    let best = 0;
    for (let i = 1; i < res.altIds.length; i++) {
      const occ = Number.isNaN(res.occupancies[i]) ? 0 : res.occupancies[i];
      const bestOcc = Number.isNaN(res.occupancies[best]) ? 0 : res.occupancies[best];
      if (occ > bestOcc) best = i;
    }
    kept.set(key, res.altIds[best]);
  }
  return { kept, byKey };
}

export function componentsForStructure(ctx: PluginContext, structureRef: string): StructureComponentRef[] {
  const s = ctx.managers.structure.hierarchy.current.structures.find(
    (entry) => entry.cell.transform.ref === structureRef,
  );
  return s?.components ?? [];
}

export function representationRefsForStructure(ctx: PluginContext, structureRef: string): string[] {
  return componentsForStructure(ctx, structureRef).flatMap((c) =>
    c.representations.map((r) => r.cell.transform.ref),
  );
}

export interface ResidueRange {
  chain: string;
  from: number;
  to: number;
}

export interface ConformerStyleState {
  /** residueKeys whose conformers are expanded (all letters visible, colored per letter) */
  shown: ReadonlySet<string>;
  /** naive global state: force this altloc letter on EVERY collapsed split residue
   * (residues lacking the letter fall back to their top-occupancy conformer); null =
   * default collapse (top occupancy everywhere) */
  globalAlt: string | null;
  /** individually toggled-off conformers of EXPANDED residues, as `${residueKey}|${letter}`
   * entries: those letters hide even while the residue's conformers are shown. Collapsed
   * residues ignore it (the collapse already picks one letter). */
  muted?: ReadonlySet<string>;
  /** polymer drawn as a trace (cartoon): the collapse layers skip the polymer component —
   * cartoon marks transparency per RESIDUE, so the altloc transparency-1 layer would knock
   * whole residues out of the trace and shred it into fragments */
  polymerAsTrace?: boolean;
}

// matches both the lab expression component ("lab-polymer") and Mol*'s static component
// ("structure-component-static-polymer") used before the lab components replace it
function isPolymerComponent(c: StructureComponentRef): boolean {
  return !!c.cell.transform.tags?.some((t) => t.endsWith("polymer"));
}

// the selection-bonds overlay component (interactions representation): never a target
// for the collapse/accent layers or the rep-style pass
export function isBondsComponent(c: StructureComponentRef): boolean {
  return !!c.cell.transform.tags?.includes("lab-bonds");
}

// a per-selection representation override (spacefill/ball-and-stick over a residue set):
// exempt from the rep-style pass and the chemistry rebuild, but it DOES take the
// collapse/accent layers so hidden conformers stay hidden inside the override
export function isSelRepComponent(c: StructureComponentRef): boolean {
  return !!c.cell.transform.tags?.includes("lab-selrep");
}

/** any app-managed overlay component whose lifecycle its own effect owns */
export function isOverlayComponent(c: StructureComponentRef): boolean {
  return isBondsComponent(c) || isSelRepComponent(c);
}

/**
 * The altloc atoms hidden by the current collapse state: every non-kept letter of every
 * collapsed split residue. Shared between the transparency layer (applyConformerStyling)
 * and the selection marker (which must not outline invisible ghost conformers).
 */
export function hiddenConformerSelectors(plan: ConformerPlan, state: ConformerStyleState): AltGroupSelector[] {
  const hidden: AltGroupSelector[] = [];
  for (const [key, res] of plan.byKey) {
    if (state.shown.has(key)) {
      // expanded residue: every letter visible EXCEPT the individually muted ones
      if (state.muted?.size) {
        for (const letter of res.altIds) {
          if (!state.muted.has(`${key}|${letter}`)) continue;
          hidden.push({
            chain: res.ref.chain,
            seqStart: res.ref.seq,
            seqEnd: res.ref.seq,
            altId: letter,
            atomId: null,
          });
        }
      }
      continue;
    }
    const kept =
      state.globalAlt && res.altIds.includes(state.globalAlt) ? state.globalAlt : plan.kept.get(key);
    for (const letter of res.altIds) {
      if (letter === kept) continue;
      hidden.push({
        chain: res.ref.chain,
        seqStart: res.ref.seq,
        seqEnd: res.ref.seq,
        altId: letter,
        atomId: null,
      });
    }
  }
  return hidden;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lociGetter(expr: any) {
  return async (root: Structure) => executeQuery(expr, root) ?? EmptyLoci;
}

/** Clear-and-reapply of every collapse/accent layer on the primary structure. Idempotent. */
export async function applyConformerStyling(
  ctx: PluginContext,
  structureRef: string,
  plan: ConformerPlan,
  state: ConformerStyleState,
): Promise<void> {
  const comps = componentsForStructure(ctx, structureRef);
  if (!comps.length) return;

  // clear on ALL comps (layers may linger from a previous polymer rep type), apply on
  // the filtered set
  await clearStructureTransparency(ctx, comps);
  await clearStructureOverpaint(ctx, comps);
  const baseComps = comps.filter((c) => !isBondsComponent(c));
  const layerComps = state.polymerAsTrace ? baseComps.filter((c) => !isPolymerComponent(c)) : baseComps;
  if (!layerComps.length) return;

  // non-kept letters of every collapsed altloc residue; a global state overrides the
  // per-residue top-occupancy choice wherever the residue actually has that letter
  const hiddenSelectors = hiddenConformerSelectors(plan, state);

  if (hiddenSelectors.length) {
    await setStructureTransparency(ctx, layerComps, 1, lociGetter(buildAltGroupExpression(hiddenSelectors)));
  }

  // letter colors on expanded residues, one overpaint layer per letter
  const byLetter = new Map<string, AltGroupSelector[]>();
  for (const key of state.shown) {
    const res = plan.byKey.get(key);
    if (!res) continue;
    for (const letter of res.altIds) {
      const list = byLetter.get(letter) ?? [];
      list.push({ chain: res.ref.chain, seqStart: res.ref.seq, seqEnd: res.ref.seq, altId: letter, atomId: null });
      byLetter.set(letter, list);
    }
  }

  // active global state: the residues the state actually switched (they carry the letter)
  // get their visible letter atoms painted in the letter color — the rest of the model
  // (unsplit residues, fallback residues) stays base, so the state reads at a glance
  if (state.globalAlt) {
    const letter = state.globalAlt;
    const list = byLetter.get(letter) ?? [];
    for (const [key, res] of plan.byKey) {
      if (state.shown.has(key)) continue; // expanded residues are already fully letter-colored
      if (!res.altIds.includes(letter)) continue;
      list.push({ chain: res.ref.chain, seqStart: res.ref.seq, seqEnd: res.ref.seq, altId: letter, atomId: null });
    }
    byLetter.set(letter, list);
  }
  for (const [letter, selectors] of byLetter) {
    await setStructureOverpaint(
      ctx,
      layerComps,
      Color(AltColors[letter] ?? ALT_FALLBACK_COLOR),
      lociGetter(buildAltGroupExpression(selectors)),
    );
  }
}

/** The comparison model: one whole-structure translucency layer, further back than A's ghost. */
export async function applySecondaryGhost(ctx: PluginContext, structureRef: string): Promise<void> {
  const comps = componentsForStructure(ctx, structureRef);
  if (!comps.length) return;
  await clearStructureTransparency(ctx, comps);
  await setStructureTransparency(ctx, comps, SECONDARY_TRANSPARENCY, async (root) => structureToLoci(root));
}
