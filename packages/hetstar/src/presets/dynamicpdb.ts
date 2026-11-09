import { ENSEMBLE_ENTRIES } from "../lib/lab/entries";
import { GhostConformerColorThemeProvider, LigandHueColorThemeProvider } from "../lib/molstar/ghost-theme";
import { DEFAULT_REP_STYLE, type RepStyle } from "../lib/molstar/repstyle";
import type { HetstarPreset } from "./types";

// The dynamicpdb.com look (structure cards, locked 2026-11-09): one cartoon in pale per-chain
// colours where a residue has one conformer, a purple ramp where it has more, single-conformer
// residues ghosted, ligands in quiet hashed hues. This is what the viewer does with no preset
// prop, so the website's HetstarPanel needs nothing.

export const CARD_REP_STYLE: RepStyle = {
  ...DEFAULT_REP_STYLE,
  type: "cartoon",
  colorMode: "conformer",
  ramp: "fade",
};

export const dynamicpdbPreset: HetstarPreset = {
  id: "dynamicpdb",
  repStyle: CARD_REP_STYLE,
  colorModes: ["conformer", "model", "element", "chain"],
  colorThemes: [GhostConformerColorThemeProvider, LigandHueColorThemeProvider],
  entries: ENSEMBLE_ENTRIES,
};
