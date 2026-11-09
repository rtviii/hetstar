import type { Location } from "molstar/lib/mol-model/location";
import { Bond, type ElementIndex, type Model, type Structure, StructureElement, Unit } from "molstar/lib/mol-model/structure";
import { OrderedSet } from "molstar/lib/mol-data/int";
import { ColorTheme } from "molstar/lib/mol-theme/color";
import { ColorThemeCategory } from "molstar/lib/mol-theme/color/categories";
import type { ThemeDataContext } from "molstar/lib/mol-theme/theme";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { Color } from "molstar/lib/mol-util/color";
import { ALT_SHARED_COLOR } from "./altloc-theme";

// The structure-card look (dynamic-pdb thumbnails, locked 2026-11-09): one cartoon in pale
// per-chain colours where a residue has one conformer, a purple ramp where it has more,
// ligands in four quiet hues. The same themes draw the cards and the viewer's default.

const GREY = Color(ALT_SHARED_COLOR);

// Chain colours by order of first appearance of the auth chain id (qFit output has no
// label_asym_id). Hues kept away from the purple so the ramp is the only saturated thing.
export const GHOST_CHAIN_COLORS = [
  Color(0xe2d7c1), // sand
  Color(0xc5cfdc), // slate
  Color(0xcfdaca), // sage
  Color(0xc4d9d8), // dusty teal
  Color(0xe3dcbe), // pale gold
  Color(0xe4cfc3), // terracotta
  Color(0xd8d5d0), // warm grey
  Color(0xcfd3da), // cool grey
];

export type ConformerRamp = "fade" | "brand" | "wide" | "muted" | "dark";
export const CONFORMER_RAMP_NAMES: ConformerRamp[] = ["fade", "brand", "wide", "muted", "dark"];

// Indexed by conformer count: 0 and 1 are never read (those residues take the chain colour),
// then two, three, four, five or more.
export const CONFORMER_RAMPS: Record<ConformerRamp, Color[]> = {
  brand: [GREY, GREY, Color(0xa78bf0), Color(0x8257ea), Color(0x663be4), Color(0x663be4)],
  wide: [GREY, GREY, Color(0xd6c9f9), Color(0x9c7ff0), Color(0x5a2fd0), Color(0x3a1a99)],
  muted: [GREY, GREY, Color(0xc9c0dc), Color(0x9478e4), Color(0x663be4), Color(0x4b26b8)],
  dark: [GREY, GREY, Color(0xb9a4f3), Color(0x7d53e7), Color(0x4b26b8), Color(0x2e1575)],
  // "brand" colours, with two- and three-conformer residues partly transparent (see
  // conformerFadeLayers) so the count reads as solidity as well as hue
  fade: [GREY, GREY, Color(0xa78bf0), Color(0x7d53e7), Color(0x5730c7), Color(0x5730c7)],
};

/** Transparency per conformer-count class on the cartoon: single-conformer residues always ghost. */
export function conformerFadeLayers(ramp: ConformerRamp): { test: (count: number) => boolean; value: number }[] {
  const layers = [{ test: (count: number) => count < 2, value: 0.65 }];
  if (ramp === "fade") {
    layers.push({ test: (count) => count === 2, value: 0.4 }, { test: (count) => count === 3, value: 0.15 });
  }
  return layers;
}

const conformerCounts = new WeakMap<Model, Uint8Array>();

/** Distinct label_alt_id values per residue of the model, computed once per model. */
export function residueConformerCounts(model: Model): Uint8Array {
  const cached = conformerCounts.get(model);
  if (cached) return cached;
  const { residueAtomSegments, atoms } = model.atomicHierarchy;
  const counts = new Uint8Array(residueAtomSegments.count);
  for (let residue = 0; residue < residueAtomSegments.count; residue += 1) {
    const alts = new Set<string>();
    for (let atom = residueAtomSegments.offsets[residue]; atom < residueAtomSegments.offsets[residue + 1]; atom = (atom + 1) as ElementIndex) {
      const alt = atoms.label_alt_id.value(atom);
      if (alt) alts.add(alt);
    }
    counts[residue] = Math.min(alts.size, 255);
  }
  conformerCounts.set(model, counts);
  return counts;
}

/** The atoms of `structure` whose residue's conformer count passes `test`. */
export function lociWhereConformerCount(structure: Structure, test: (count: number) => boolean): StructureElement.Loci {
  const elements: StructureElement.Loci["elements"][0][] = [];
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    const counts = residueConformerCounts(unit.model);
    const picked: StructureElement.UnitIndex[] = [];
    for (let index = 0; index < unit.elements.length; index += 1) {
      if (test(counts[unit.residueIndex[unit.elements[index]]])) picked.push(index as StructureElement.UnitIndex);
    }
    if (picked.length > 0) elements.push({ unit, indices: OrderedSet.ofSortedArray(picked) });
  }
  return StructureElement.Loci(structure, elements);
}

const chainOrders = new WeakMap<Model, Map<string, number>>();

function chainPaletteIndex(model: Model, element: ElementIndex): number {
  let order = chainOrders.get(model);
  if (!order) {
    order = new Map();
    const { chains } = model.atomicHierarchy;
    for (let chain = 0; chain < chains._rowCount; chain += 1) {
      const id = chains.auth_asym_id.value(chain);
      if (!order.has(id)) order.set(id, order.size);
    }
    chainOrders.set(model, order);
  }
  const chainIndex = model.atomicHierarchy.chainAtomSegments.index[element];
  return order.get(model.atomicHierarchy.chains.auth_asym_id.value(chainIndex)) ?? 0;
}

function ghostConformerColor(unit: Unit, element: ElementIndex, ramp: Color[]): Color {
  if (!Unit.isAtomic(unit)) return GREY;
  const count = residueConformerCounts(unit.model)[unit.residueIndex[element]];
  if (count >= 2) return ramp[Math.min(count, ramp.length - 1)];
  return GHOST_CHAIN_COLORS[chainPaletteIndex(unit.model, element) % GHOST_CHAIN_COLORS.length];
}

export const GhostConformerColorThemeParams = {
  ramp: PD.Select<ConformerRamp>("fade", CONFORMER_RAMP_NAMES.map((name) => [name, name] as [ConformerRamp, string])),
};
export type GhostConformerColorThemeParams = typeof GhostConformerColorThemeParams;

export function GhostConformerColorTheme(
  _ctx: ThemeDataContext,
  props: PD.Values<GhostConformerColorThemeParams>,
): ColorTheme<GhostConformerColorThemeParams> {
  const ramp = CONFORMER_RAMPS[props.ramp] ?? CONFORMER_RAMPS.fade;
  return {
    factory: GhostConformerColorTheme,
    granularity: "group",
    color: (location: Location): Color => {
      if (StructureElement.Location.is(location)) return ghostConformerColor(location.unit, location.element, ramp);
      if (Bond.isLocation(location)) return ghostConformerColor(location.aUnit, location.aUnit.elements[location.aIndex], ramp);
      return GREY;
    },
    props,
    description: "Pale chain colours, with a purple ramp on residues that have alternate conformers.",
  };
}

export const GhostConformerColorThemeProvider: ColorTheme.Provider<GhostConformerColorThemeParams, "ghost-conformer"> = {
  name: "ghost-conformer",
  label: "Ghost chains, purple conformers",
  category: ColorThemeCategory.Residue,
  factory: GhostConformerColorTheme,
  getParams: () => GhostConformerColorThemeParams,
  defaultValues: PD.getDefaultValues(GhostConformerColorThemeParams),
  isApplicable: (ctx: ThemeDataContext) => !!ctx.structure,
};

// Four quiet colours, none green or purple, picked by a hash of the component id so the
// same compound has the same colour everywhere.
const LIGAND_PALETTE = [Color(0x2f8f9d), Color(0xc9892a), Color(0xb5533c), Color(0x4a6fa5)];
export const ION_COLOR = 0x5f616b;

function ligandColor(compId: string): Color {
  let hash = 0;
  for (let i = 0; i < compId.length; i += 1) hash = compId.charCodeAt(i) + ((hash << 5) - hash);
  return LIGAND_PALETTE[Math.abs(hash) % LIGAND_PALETTE.length];
}

function compColor(unit: Unit, element: ElementIndex): Color {
  if (!Unit.isAtomic(unit)) return GREY;
  return ligandColor(unit.model.atomicHierarchy.atoms.label_comp_id.value(element));
}

export const LigandHueColorThemeParams = {};
export type LigandHueColorThemeParams = typeof LigandHueColorThemeParams;

export function LigandHueColorTheme(
  _ctx: ThemeDataContext,
  props: PD.Values<LigandHueColorThemeParams>,
): ColorTheme<LigandHueColorThemeParams> {
  return {
    factory: LigandHueColorTheme,
    granularity: "group",
    color: (location: Location): Color => {
      if (StructureElement.Location.is(location)) return compColor(location.unit, location.element);
      if (Bond.isLocation(location)) return compColor(location.aUnit, location.aUnit.elements[location.aIndex]);
      return GREY;
    },
    props,
    description: "One hashed hue per ligand component id.",
  };
}

export const LigandHueColorThemeProvider: ColorTheme.Provider<LigandHueColorThemeParams, "ligand-hue"> = {
  name: "ligand-hue",
  label: "Ligand hue",
  category: ColorThemeCategory.Residue,
  factory: LigandHueColorTheme,
  getParams: () => LigandHueColorThemeParams,
  defaultValues: PD.getDefaultValues(LigandHueColorThemeParams),
  isApplicable: (ctx: ThemeDataContext) => !!ctx.structure,
};
