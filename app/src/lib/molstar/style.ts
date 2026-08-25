import type { ColorTheme } from "molstar/lib/mol-theme/color";
import { Color } from "molstar/lib/mol-util/color";

// Illustrative "demo" look lifted from ~/dev/fend_tubulinxyz (postprocessing-config.ts):
// a black outline + ambient occlusion, no shadows. Paired with a white canvas and a flat
// (ignoreLight) material on every representation, this gives the stylized, unlit look the
// cartoon/ball-and-stick reads with instead of Mol*'s default shiny lit material.
export const STYLIZED_POSTPROCESSING = {
  outline: {
    name: "on" as const,
    params: { scale: 0.5, color: Color(0x000000), threshold: 0.33, includeTransparent: true },
  },
  occlusion: {
    name: "on" as const,
    params: {
      multiScale: { name: "off" as const, params: {} },
      radius: 5,
      bias: 0.8,
      blurKernelSize: 15,
      blurDepthBias: 0.5,
      samples: 32,
      resolutionScale: 1,
      color: Color(0x000000),
    },
  },
  shadow: { name: "off" as const, params: {} },
};

export const WHITE_BACKGROUND = Color(0xffffff);

// Components to render as ball-and-stick by default (everything except water/coarse, so the
// view isn't dominated by scattered solvent oxygens).
export const BALL_AND_STICK_COMPONENTS = ["polymer", "ligand", "ion", "branched", "lipid"] as const;

// Polymer-only component list for trace-based representations (cartoon / putty) that have no
// meaning on isolated ligands or ions.
export const POLYMER_COMPONENTS = ["polymer"] as const;

// How to render a loaded structure: which representation + colour theme. The default reproduces
// the app's flat ball-and-stick look; the examples drawer overrides it per structure to showcase
// a particular heterogeneity feature (B-factor colouring, ANISOU ellipsoids, etc.).
export type ExampleRepresentation = "ball-and-stick" | "ellipsoid" | "putty" | "cartoon" | "spacefill";

export interface StructureView {
  representation: ExampleRepresentation;
  colorTheme: ColorTheme.BuiltIn | "alt-loc"; // "alt-loc" is our custom theme registered at viewer init
}

export const DEFAULT_VIEW: StructureView = { representation: "ball-and-stick", colorTheme: "element-symbol" };

// Representations that only render on the polymer trace; for these we skip ligand/ion/etc.
export const POLYMER_ONLY_REPRESENTATIONS: ReadonlyArray<ExampleRepresentation> = ["cartoon", "putty"];
