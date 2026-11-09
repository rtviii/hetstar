import { HETCIF_ENTRIES } from "../lib/lab/entries";
import { DEFAULT_REP_STYLE } from "../lib/molstar/repstyle";
import type { HetstarPreset } from "./types";

// The hetcif look (~/dev/hetcif): every atom as ball-and-stick so a world's chosen states
// are visible atoms, model colours so the letter accents and the world panel's swatches are
// the only colour, and the hetcif example files in the entry chip. No conformer-count ramp:
// which conformer is shown matters here, not how many there are.

export const hetcifPreset: HetstarPreset = {
  id: "hetcif",
  repStyle: DEFAULT_REP_STYLE,
  colorModes: ["model", "element", "chain"],
  colorThemes: [],
  entries: HETCIF_ENTRIES,
};
