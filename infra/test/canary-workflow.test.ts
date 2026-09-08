import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

it("runs the live canary nightly and on every native adapter change, with read-only workflow permissions", () => {
  const workflow = z
    .object({
      on: z.object({
        push: z.never().optional(),
        schedule: z.array(z.object({ cron: z.string() })).min(1),
        pull_request: z.object({ paths: z.array(z.string()) }),
      }),
      permissions: z.object({ contents: z.literal("read") }).strict(),
      jobs: z.object({
        canary: z.object({
          if: z.string(),
          steps: z.array(
            z.object({
              run: z.string().optional(),
              uses: z.string().optional(),
              with: z.record(z.string(), z.unknown()).optional(),
            }),
          ),
        }),
      }),
    })
    .parse(
      parse(
        readFileSync(
          new URL("../../.github/workflows/live-canary.yml", import.meta.url),
          "utf8",
        ),
      ) as unknown,
    );
  for (const path of [
    "packages/hook/**",
    "packages/pi-extension/**",
    "packages/traces/**",
    "packages/core/normalizers/**",
    "packages/core/redaction/**",
    "packages/core/schemas/**",
    "packages/core/format/**",
    "apps/api/src/services/trace-projection.ts",
    "apps/api/src/services/trace-audit-projection.ts",
    "scripts/canary-*.ts",
    "apps/api/src/services/jobs.ts",
    "apps/api/src/routes/**",
    "apps/api/src/mcp/**",
    "fixtures/hooks/**",
  ])
    expect(workflow.on.pull_request.paths).toContain(path);
  expect(workflow.jobs.canary.if).toContain(
    "github.event.pull_request.head.repo.full_name == github.repository",
  );
  expect(
    workflow.jobs.canary.steps.some((step) =>
      step.run?.includes("pnpm test:canary"),
    ),
  ).toBe(true);
  const artifacts = workflow.jobs.canary.steps.find(
    (step) => step.uses === "actions/upload-artifact@v4",
  )?.with?.path;
  expect(artifacts).toBe(
    "test-results/live-canary/report.json\ntest-results/live-canary/*-mobile.png\n",
  );
});
