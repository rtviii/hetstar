import type { Location } from "molstar/lib/mol-model/location";
import { Bond, type ElementIndex, type Model, StructureElement, Unit } from "molstar/lib/mol-model/structure";
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import { ColorThemeCategory } from "molstar/lib/mol-theme/color/categories";
import type { ThemeDataContext } from "molstar/lib/mol-theme/theme";
import { Color } from "molstar/lib/mol-util/color";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { residueKey } from "@dynamic-pdb/hetkit/model";
import type { Track } from "@dynamic-pdb/hetkit/metrics";
import { rampColor } from "../lab/color";

// A hetkit Track painted onto the atoms of a structure, per residue. The track is keyed by
// author chain|seq|ins, the same keys every other consumer uses, so one paint applies to any
// model of the entry: residues the track does not cover take the missing colour.

export const TRACK_THEME_NAME = "hetstar-track";
const MISSING_COLOR = Color(0xd9d9d9);

/** residue key (hetkit residueKey) to colour, resolved once per track + domain + ramp */
export interface TrackPaint {
  colors: ReadonlyMap<string, Color>;
}

export function trackPaint(track: Track, domain: [number, number], stops: number[]): TrackPaint {
  const colors = new Map<string, Color>();
  const span = domain[1] - domain[0];
  for (let i = 0; i < track.keys.length; i += 1) {
    const value = track.values[i];
    if (Number.isNaN(value)) continue;
    const [r, g, b] = rampColor(stops, span > 0 ? (value - domain[0]) / span : 0);
    colors.set(residueKey(track.keys[i]), Color.fromRgb(Math.round(r), Math.round(g), Math.round(b)));
  }
  return { colors };
}

function residueColors(model: Model, paint: TrackPaint): Uint32Array {
  const { residueAtomSegments, residues, chainAtomSegments, chains } = model.atomicHierarchy;
  const out = new Uint32Array(residueAtomSegments.count);
  for (let residue = 0; residue < residueAtomSegments.count; residue += 1) {
    const firstAtom = residueAtomSegments.offsets[residue];
    const rawIns = residues.pdbx_PDB_ins_code.value(residue as never);
    const key = residueKey({
      chain: chains.auth_asym_id.value(chainAtomSegments.index[firstAtom]),
      seq: residues.auth_seq_id.value(residue as never),
      ins: rawIns === "?" || rawIns === "." ? "" : (rawIns ?? ""),
    });
    out[residue] = paint.colors.get(key) ?? MISSING_COLOR;
  }
  return out;
}

export const TrackColorThemeParams = {
  paint: PD.Value<TrackPaint | null>(null, { isHidden: true }),
};
export type TrackColorThemeParams = typeof TrackColorThemeParams;

export function TrackColorTheme(
  _ctx: ThemeDataContext,
  props: PD.Values<TrackColorThemeParams>,
): ColorTheme<TrackColorThemeParams> {
  const perModel = new Map<Model, Uint32Array>();
  const colorOf = (unit: Unit, element: ElementIndex): Color => {
    if (!props.paint || !Unit.isAtomic(unit)) return MISSING_COLOR;
    let colors = perModel.get(unit.model);
    if (!colors) perModel.set(unit.model, (colors = residueColors(unit.model, props.paint)));
    return colors[unit.residueIndex[element]] as Color;
  };
  return {
    factory: TrackColorTheme,
    granularity: "group",
    color: (location: Location): Color => {
      if (StructureElement.Location.is(location)) return colorOf(location.unit, location.element);
      if (Bond.isLocation(location)) return colorOf(location.aUnit, location.aUnit.elements[location.aIndex]);
      return MISSING_COLOR;
    },
    props,
    description: "A per-residue metric track painted onto the atoms.",
  };
}

export const TrackColorThemeProvider: ColorTheme.Provider<TrackColorThemeParams, typeof TRACK_THEME_NAME> = {
  name: TRACK_THEME_NAME,
  label: "Metric track",
  category: ColorThemeCategory.Residue,
  factory: TrackColorTheme,
  getParams: () => TrackColorThemeParams,
  defaultValues: PD.getDefaultValues(TrackColorThemeParams),
  isApplicable: (ctx: ThemeDataContext) => !!ctx.structure,
};
