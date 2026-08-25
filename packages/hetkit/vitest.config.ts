import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // molstar's lib/ tree is ESM-syntax .js in a package without "type": "module",
    // so node cannot load it natively; force it through vitest's transform pipeline.
    server: {
      deps: {
        inline: [/molstar/],
      },
    },
    testTimeout: 30000,
  },
});
