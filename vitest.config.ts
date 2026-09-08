import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "infra/**/*.test.ts",
      "e2e/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    maxWorkers: 4,
    restoreMocks: true,
    clearMocks: true,
  },
});
