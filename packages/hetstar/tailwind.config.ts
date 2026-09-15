import type { Config } from "tailwindcss";

// Palette: Dynamic PDB's Prism brand kit (dynamic-pdb/website/src/app/globals.css), so the
// viewer reads as one system inside that site. Purple is the only saturated color and is
// reserved for pressed state, links, focus rings and progress. Scientific colors (models,
// maps, altlocs, metric ramps) live under src/lib and are not tokens.
//
// The stylesheet is compiled once (npm run css) into hetstar.css so hosts need no Tailwind.
// Every utility is scoped under the .hetstar wrapper and Tailwind's global preflight is off;
// src/styles.css carries a reset that only applies inside that wrapper.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  important: ".hetstar",
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: "#663be4", hover: "#5730c7", soft: "#f1edfd" },
        ink: { DEFAULT: "#1a1e2a", secondary: "#3d414f", muted: "#5f616b" },
        line: { DEFAULT: "#eaebf4", strong: "#d5d7e4" },
        surface: { DEFAULT: "#ffffff", muted: "#f2f3f8" },
        danger: { DEFAULT: "#b4231d", soft: "#fbecea" },
      },
      boxShadow: {
        "ring-accent": "0 0 0 3px rgba(102, 59, 228, 0.2)",
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
