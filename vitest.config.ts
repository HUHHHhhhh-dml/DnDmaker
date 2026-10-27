import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/shared/src/**/*.test.ts",
      "apps/server/src/**/*.test.ts",
    ],
    globals: false,
    testTimeout: 20_000,
  },
});
