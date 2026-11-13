import type { Config } from "tailwindcss";

// Look: Harbor Mono (crboost_server, roadmap 51) on the Prism brand kit of Dynamic PDB
// (dynamic-pdb/website/src/app/globals.css). Two voices of type: IBM Plex Mono in small
// capitals for everything that is a label, a control or a badge; IBM Plex Sans for names
// and prose; plain Plex Mono for values. Corners are 2 px, panels carry no drop shadow, and
// a card holds no second box: a section is its title stripe and its content. Purple is the
// only saturated color: the stripe's tick, pressed state, links, focus and progress.
// Scientific colors (models, maps, altlocs, metric ramps) live under src/lib and are not
// tokens. The voices and the stripe are classes in src/styles.css (hs-*).
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
        accent: { DEFAULT: "#663be4", hover: "#5730c7", soft: "#f1edfd", line: "#d9cffa" },
        ink: { DEFAULT: "#1a1e2a", secondary: "#3d414f", muted: "#5f616b", faint: "#9a9dab" },
        line: { DEFAULT: "#e6e7f0", strong: "#d0d2e0" },
        surface: { DEFAULT: "#ffffff", muted: "#f4f4f9", head: "#f6f4fd", hover: "#efebfb" },
        danger: { DEFAULT: "#b4231d", soft: "#fbecea" },
      },
      borderRadius: {
        none: "0",
        sm: "1px",
        DEFAULT: "2px",
        md: "2px",
        lg: "2px",
        xl: "3px",
      },
      boxShadow: {
        sm: "none",
        pop: "0 6px 18px rgba(26, 30, 42, 0.10)",
        "ring-accent": "0 0 0 2px rgba(102, 59, 228, 0.18)",
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
