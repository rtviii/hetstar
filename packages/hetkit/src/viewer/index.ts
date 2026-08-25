import type { Location } from "molstar/lib/mol-model/location";
import { Bond, StructureElement, Unit, type ElementIndex } from "molstar/lib/mol-model/structure";
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import { ColorThemeCategory } from "molstar/lib/mol-theme/color/categories";
import type { ThemeDataContext } from "molstar/lib/mol-theme/theme";
import { Color } from "molstar/lib/mol-util/color";
import { ColorScale } from "molstar/lib/mol-util/color/scale";
import type { ColorListName } from "molstar/lib/mol-util/color/lists";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";

import { residueKey } from "../model/keys";
import type { Track } from "../metrics/tracks";

// The 1D-to-3D bridge: turn a residue-level Track into a Mol* color theme, so the same
// numbers drive the sequence strip and the structure. Register the returned provider on
// a plugin (ctx.representation.structure.themes.colorThemeRegistry.add) or hand it to a
// representation directly. Pattern follows app/src/lib/molstar/altloc-theme.ts.

export interface TrackColorThemeOptions {
  /** overrides track.domain for the color mapping */
  domain?: [number, number];
  /** a Mol* color list name; default 'orange-red' (sequential) */
  colorList?: ColorListName;
  /** color for residues the track has no value for */
  missingColor?: Color;
  /** registry name; default `track-${track.metricId}` */
  name?: string;
}

const DEFAULT_MISSING = Color(0xcfd8dc);

export function trackColorTheme(track: Track, opts: TrackColorThemeOptions = {}): ColorTheme.Provider<{}, string> {
  const name = opts.name ?? `track-${track.metricId}`;
  const missing = opts.missingColor ?? DEFAULT_MISSING;

  const byResidue = new Map<string, number>();
  for (let i = 0; i < track.keys.length; i++) {
    const v = track.values[i];
    if (!Number.isNaN(v)) byResidue.set(residueKey(track.keys[i]), v);
  }

  const scale = ColorScale.create({
    domain: opts.domain ?? track.domain,
    listOrName: opts.colorList ?? "orange-red",
  });

  function elementValue(unit: Unit, element: ElementIndex): number | undefined {
    if (!Unit.isAtomic(unit)) return undefined;
    const h = unit.model.atomicHierarchy;
    const rI = h.residueAtomSegments.index[element];
    const cI = h.chainAtomSegments.index[element];
    const key = residueKey({
      chain: h.chains.auth_asym_id.value(cI),
      seq: h.residues.auth_seq_id.value(rI),
      ins: h.residues.pdbx_PDB_ins_code.value(rI) ?? "",
    });
    return byResidue.get(key);
  }

  function themeColor(unit: Unit, element: ElementIndex): Color {
    const v = elementValue(unit, element);
    return v === undefined ? missing : scale.color(v);
  }

  const factory = (_ctx: ThemeDataContext, props: PD.Values<{}>): ColorTheme<{}> => ({
    factory,
    granularity: "group",
    color: (location: Location): Color => {
      if (StructureElement.Location.is(location)) return themeColor(location.unit, location.element);
      if (Bond.isLocation(location)) return themeColor(location.aUnit, location.aUnit.elements[location.aIndex]);
      return missing;
    },
    props,
    description: `Residues colored by ${track.metricId}.`,
    legend: scale.legend,
  });

  return {
    name,
    label: `Track: ${track.metricId}`,
    category: ColorThemeCategory.Misc,
    factory,
    getParams: () => ({}),
    defaultValues: PD.getDefaultValues({}),
    isApplicable: (ctx: ThemeDataContext) => !!ctx.structure,
  };
}
