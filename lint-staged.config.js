export default {
  "*.{ts,tsx,js,mjs,cjs}": ["eslint --fix", "prettier --write"],
  "*.{json,yaml,yml,md,css,html}": "prettier --write",
  "packages/db/prisma/**/*.prisma": () =>
    "pnpm --filter @agentcommons/db exec prisma format",
  "fixtures/**/*": () => "pnpm fixtures:check",
  "{README.md,apps/dashboard/src/copy.ts}": () =>
    "node scripts/copy-review.mjs",
};
