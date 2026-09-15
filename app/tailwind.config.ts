import type { Config } from "tailwindcss";

// Palette: Dynamic PDB's Prism brand kit (dynamic-pdb/website/src/app/globals.css), so the
// lab reads as one system once it is embedded there. Purple is the only saturated color
// and is reserved for pressed state, links, focus rings and progress. Scientific colors
// (models, maps, altlocs, metric ramps) live under src/lib and are not tokens.
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
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
