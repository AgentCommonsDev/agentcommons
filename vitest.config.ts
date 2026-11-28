import { defineConfig } from "vitest/config";
import { bundleOpencodePlugin } from "./packages/hook/opencode-plugin-bundle.js";

export default defineConfig({
  define: {
    AGENTCOMMONS_OPENCODE_PLUGIN: JSON.stringify(bundleOpencodePlugin()),
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "infra/**/*.test.ts",
      "e2e/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    maxWorkers: 4,
    restoreMocks: true,
    clearMocks: true,
  },
});
