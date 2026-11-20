import { DEFAULT_REP_STYLE } from "../lib/molstar/repstyle";
import type { HetstarPreset } from "../presets/types";
import { HETCIF_ENTRIES } from "./entries";
import { hetcifModule } from "./module";

// The hetcif preset (~/dev/hetcif): every atom as ball-and-stick so a world's chosen states
// are visible atoms, model colours so the letter accents and the world panel's swatches are
// the only colour, the hetcif example files in the entry chip, and the hetcif module, which
// is the only way the viewer comes to read _hetcif_* categories at all. No conformer-count
// ramp: which conformer is shown matters here, not how many there are.

export const hetcifPreset: HetstarPreset = {
  id: "hetcif",
  repStyle: DEFAULT_REP_STYLE,
  colorModes: ["model", "element", "chain"],
  colorThemes: [],
  entries: HETCIF_ENTRIES,
  module: hetcifModule,
};
