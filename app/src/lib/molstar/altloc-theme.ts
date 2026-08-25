import type { Location } from "molstar/lib/mol-model/location";
import { Bond, type ElementIndex, StructureElement, Unit } from "molstar/lib/mol-model/structure";
import { ColorTheme } from "molstar/lib/mol-theme/color";
import { ColorThemeCategory } from "molstar/lib/mol-theme/color/categories";
import type { ThemeDataContext } from "molstar/lib/mol-theme/theme";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { Color } from "molstar/lib/mol-util/color";

// A custom color theme that paints atoms by their alternate-location id (`label_alt_id`) — there is
// no built-in alt-loc theme. Atoms with no altloc are grey; A/B/C/D/E get distinct colours so the
// split conformers in a structure read apart at a glance. Registered on the plugin at init and used
// by the "Alternate conformations" examples via `color: 'alt-loc'`.
const NoAlt = Color(0xcfd8dc);
const OtherAlt = Color(0x8c564b);
const AltColors: Record<string, number> = {
  A: 0x2ca02c,
  B: 0xd62728,
  C: 0x1f77b4,
  D: 0xff7f0e,
  E: 0x9467bd,
};

function altColor(unit: Unit, element: ElementIndex): Color {
  if (!Unit.isAtomic(unit)) return NoAlt;
  const alt = unit.model.atomicHierarchy.atoms.label_alt_id.value(element);
  if (!alt) return NoAlt;
  const c = AltColors[alt];
  return c === undefined ? OtherAlt : Color(c);
}

export const AltLocColorThemeParams = {};
export type AltLocColorThemeParams = typeof AltLocColorThemeParams;

export function AltLocColorTheme(
  _ctx: ThemeDataContext,
  props: PD.Values<AltLocColorThemeParams>,
): ColorTheme<AltLocColorThemeParams> {
  const color = (location: Location): Color => {
    if (StructureElement.Location.is(location)) return altColor(location.unit, location.element);
    if (Bond.isLocation(location)) return altColor(location.aUnit, location.aUnit.elements[location.aIndex]);
    return NoAlt;
  };
  return {
    factory: AltLocColorTheme,
    granularity: "group",
    color,
    props,
    description: "Colours atoms by alternate-location id (label_alt_id): A/B/C… distinct, shared atoms grey.",
  };
}

export const AltLocColorThemeProvider: ColorTheme.Provider<AltLocColorThemeParams, "alt-loc"> = {
  name: "alt-loc",
  label: "Alt Loc",
  category: ColorThemeCategory.Atom,
  factory: AltLocColorTheme,
  getParams: () => AltLocColorThemeParams,
  defaultValues: PD.getDefaultValues(AltLocColorThemeParams),
  isApplicable: (ctx: ThemeDataContext) => !!ctx.structure,
};
