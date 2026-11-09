import type { ColorTheme } from "molstar/lib/mol-theme/color";
import type { EntryDef } from "../lib/lab/entries";
import type { RepColorMode, RepStyle } from "../lib/molstar/repstyle";

// A preset is a consumer's opinions about the viewer: how a structure looks when it opens,
// which colour modes the style tray offers, which Mol* colour themes exist, and which
// example entries the entry chip lists. Everything the viewer does because of what a FILE
// carries (altlocs, model numbers, hetcif categories) is not here: that is the engine's
// business and the same under every preset. Two presets ship: dynamicpdb (the default, the
// structure-card look) and hetcif (ball-and-stick, letter colours, the hetcif examples).

export interface HetstarPreset {
  id: string;
  /** the representation the viewer opens with and "reset all" returns to */
  repStyle: RepStyle;
  /** colour modes offered in the style tray, in order; a mode whose theme the preset does
   * not register must not be listed */
  colorModes: readonly RepColorMode[];
  /** Mol* colour theme providers to register besides the alt-loc theme the engine always has */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colorThemes: readonly ColorTheme.Provider<any, any>[];
  /** example entries the entry chip lists and accepts by id (catalogue ids always work) */
  entries: readonly EntryDef[];
}
