import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/shared/src/**/*.test.ts",
      "apps/server/src/**/*.test.ts",
      // Tests puros de libs del cliente (sin DOM/React). Justificado en 3F:
      // el descarte local del último combate no necesita jsdom.
      "apps/web/src/lib/**/*.test.ts",
    ],
    globals: false,
    testTimeout: 20_000,
  },
});
