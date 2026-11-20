import type { ColorTheme } from "molstar/lib/mol-theme/color";
import type { EntryDef } from "../lib/lab/entries";
import type { RepColorMode, RepStyle } from "../lib/molstar/repstyle";
import type { HetstarModule } from "../module";

// A preset is a consumer's choices about the viewer: how a structure looks when it opens,
// which colour modes the style board offers, which Mol* colour themes exist, which example
// entries the entry chip lists, and which module, if any, runs beside the engine (module.ts).
// What the viewer does because of what a file carries in standard mmCIF (altlocs, model
// numbers) is the engine's business and the same under every preset. Anything beyond that
// belongs to a module, and a preset without one never loads it. The dynamicpdb preset (the
// default, the structure-card look) is here and has no module. A preset with a module lives
// in a folder of its own under src/ and is exported from a subpath of the package, never
// from the main entry.

export interface HetstarPreset {
  id: string;
  /** the representation the viewer opens with and "reset all" returns to */
  repStyle: RepStyle;
  /** colour modes offered on the style board, in order; a mode whose theme the preset does
   * not register must not be listed */
  colorModes: readonly RepColorMode[];
  /** Mol* colour theme providers to register besides the alt-loc theme the engine always has */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colorThemes: readonly ColorTheme.Provider<any, any>[];
  /** example entries the entry chip lists and accepts by id (catalogue ids always work) */
  entries: readonly EntryDef[];
  /** optional behaviour beside the engine (module.ts); read once, at mount */
  module?: HetstarModule;
}
