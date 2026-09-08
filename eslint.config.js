import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import react from "eslint-plugin-react";
import globals from "globals";
import tseslint from "typescript-eslint";
import { architecture } from "./scripts/eslint-architecture.js";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      "fixtures/**",
      "apps/dashboard/src/lib/api/generated.ts",
      "apps/api/public/hook/**",
      "packages/db/generated/**",
    ],
  },
  js.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    plugins: { architecture },
    rules: {
      "architecture/services-only": "error",
      "architecture/harness-data": "error",
    },
  },
  {
    files: ["apps/dashboard/src/**/*.tsx"],
    plugins: { react },
    rules: {
      "react/jsx-no-literals": [
        "error",
        { noStrings: true, ignoreProps: true, allowedStrings: [] },
      ],
      "architecture/public-copy-attributes": "error",
    },
  },
  prettier,
);
