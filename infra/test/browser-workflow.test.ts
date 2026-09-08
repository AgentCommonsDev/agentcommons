import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

// @req R-DASH-07
it("schedules the live browser review and keeps provider credentials out of fork jobs and artifacts", () => {
  const workflow = z
    .object({
      on: z.object({
        schedule: z.array(z.object({ cron: z.string().min(1) })).min(1),
        pull_request: z.object({ paths: z.array(z.string()) }),
        workflow_dispatch: z.unknown(),
      }),
      permissions: z.object({ contents: z.literal("read") }).strict(),
      jobs: z.object({
        review: z.object({
          if: z.string(),
          steps: z.array(
            z.object({
              uses: z.string().optional(),
              run: z.string().optional(),
              env: z.record(z.string(), z.string()).optional(),
              with: z.record(z.string(), z.unknown()).optional(),
            }),
          ),
        }),
      }),
    })
    .parse(
      parse(
        readFileSync(
          new URL(
            "../../.github/workflows/browser-review.yml",
            import.meta.url,
          ),
          "utf8",
        ),
      ) as unknown,
    );
  expect(workflow.on.pull_request.paths).toContain("apps/dashboard/**");
  expect(workflow.jobs.review.if).toContain(
    "github.event.pull_request.head.repo.full_name == github.repository",
  );
  const credentialSteps = workflow.jobs.review.steps.filter(
    (step) => step.env?.ANTHROPIC_API_KEY,
  );
  expect(credentialSteps).toHaveLength(1);
  expect(credentialSteps[0]?.run).toContain("pnpm test:browser-agent");
  expect(credentialSteps[0]?.run).toContain("exit 1");
  expect(
    workflow.jobs.review.steps.find(
      (step) => step.uses === "actions/upload-artifact@v4",
    )?.with?.path,
  ).toBe("test-results/browser-agent/report.json");
});
