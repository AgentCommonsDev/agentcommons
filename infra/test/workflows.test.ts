import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const stepSchema = z.object({
  uses: z.string().optional(),
  run: z.string().optional(),
  if: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});
const jobSchema = z
  .object({
    if: z.string().optional(),
    environment: z.string().optional(),
    permissions: z.record(z.string(), z.string()).optional(),
    steps: z.array(stepSchema),
  })
  .loose();
function workflow(name: string) {
  return z
    .object({
      on: z.record(z.string(), z.unknown()),
      jobs: z.record(z.string(), jobSchema),
    })
    .parse(
      parse(
        readFileSync(
          new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
          "utf8",
        ),
      ) as unknown,
    );
}
// @req R-INF-03
it("previews same-repository PRs with OIDC and a separate preview role", () => {
  const config = workflow("deploy");
  expect(config.on).toHaveProperty("pull_request");
  expect(config.jobs.preview).toMatchObject({
    environment: "preview",
    permissions: { "id-token": "write" },
  });
  expect(config.jobs.preview?.if).toContain(
    "head.repo.full_name == github.repository",
  );
  expect(
    config.jobs.preview?.steps.find((step) => step.uses === "pulumi/actions@v6")
      ?.with?.command,
  ).toBe("preview");
  expect(
    config.jobs.preview?.steps.find(
      (step) => step.uses === "aws-actions/configure-aws-credentials@v4",
    )?.with?.["role-to-assume"],
  ).toBe("${{ vars.AWS_PREVIEW_ROLE_ARN }}");
});
// @req R-INF-03
it("deploys the successful CI commit and puts production behind its GitHub environment", () => {
  const config = workflow("deploy");
  expect(config.jobs.deploy?.if).toMatch(
    /^vars\.DEPLOYMENTS_ENABLED == 'true' && \(/,
  );
  expect(config.on.workflow_run).toMatchObject({
    workflows: ["CI"],
    branches: ["main"],
    types: ["completed"],
  });
  expect(config.jobs.deploy?.if).toContain(
    "github.event.workflow_run.conclusion == 'success'",
  );
  expect(config.jobs.deploy?.if).toContain(
    "github.event.workflow_run.event == 'push'",
  );
  expect(config.jobs.deploy?.if).toContain(
    "github.event.workflow_run.head_repository.full_name == github.repository",
  );
  expect(config.jobs.deploy?.if).toContain("github.ref == 'refs/heads/main'");
  expect(config.jobs.deploy?.environment).toBe("${{ inputs.stack || 'dev' }}");
  expect(
    config.jobs.deploy?.steps.find(
      (step) => step.uses === "actions/checkout@v4",
    )?.with?.ref,
  ).toBe("${{ github.event.workflow_run.head_sha || github.sha }}");
  expect(
    config.jobs.deploy?.steps.find((step) => step.uses === "pulumi/actions@v6")
      ?.with?.command,
  ).toBe("up");
  expect(
    config.jobs.deploy?.steps.find((step) => step.run === "pnpm verify")?.if,
  ).toBe("github.event_name == 'workflow_dispatch'");
});
// @req R-INF-05
it("runs fixture redaction, integration, E2E, schema drift, and traceability checks in CI", () => {
  const steps = workflow("ci").jobs.verify?.steps.map((step) => step.run);
  for (const script of [
    "fixtures:check",
    "test:integration",
    "test:e2e:built",
    "openapi:check",
    "db:validate",
    "db:diff",
    "spec:check",
  ]) {
    expect(steps).toContain(`pnpm ${script}`);
  }
  expect(steps?.filter((step) => step === "pnpm build")).toHaveLength(1);
  expect(steps).not.toContain("pnpm test:e2e");
  expect(steps?.indexOf("pnpm build")).toBeLessThan(
    steps?.indexOf("pnpm test:e2e:built") ?? -1,
  );
});
