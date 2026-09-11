import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const stepSchema = z.object({
  uses: z.string().optional(),
  run: z.string().optional(),
  if: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
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
const pathTriggerSchema = z.object({ paths: z.array(z.string()) });
const scheduleSchema = z.array(z.object({ cron: z.string().min(1) })).min(1);
function workflow(name: string) {
  return z
    .object({
      on: z.record(z.string(), z.unknown()),
      permissions: z.record(z.string(), z.string()).optional(),
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
const harnessVersions = z
  .record(z.string(), z.object({ package: z.string(), version: z.string() }))
  .parse(
    JSON.parse(
      readFileSync(
        new URL("../../scripts/harness-versions.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const workflowNames = [
  "ci",
  "deploy",
  "installer",
  "browser-review",
  "live-canary",
];

it("sets up every job through the shared composite action right after checkout", () => {
  for (const name of workflowNames)
    for (const job of Object.values(workflow(name).jobs)) {
      const uses = job.steps.map((step) => step.uses);
      const checkout = uses.indexOf("actions/checkout@v4");
      expect(checkout).toBeGreaterThanOrEqual(0);
      expect(uses[checkout + 1]).toBe("./.github/actions/setup");
      expect(uses).not.toContain("pnpm/action-setup@v4");
      expect(job.steps.map((step) => step.run)).not.toContain(
        "pnpm install --frozen-lockfile",
      );
    }
});
it("pins the native harness CLIs in one file that the workflows and the canary read", () => {
  const devDependencies = z
    .object({ devDependencies: z.record(z.string(), z.string()) })
    .parse(
      JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
      ),
    ).devDependencies;
  expect(Object.keys(harnessVersions).sort()).toEqual([
    "claude",
    "codex",
    "gemini",
    "pi",
  ]);
  for (const entry of Object.values(harnessVersions))
    expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
  // pi is installed from the workspace, so its pin is the root devDependency.
  expect(devDependencies[harnessVersions.pi?.package ?? ""]).toBe(
    harnessVersions.pi?.version,
  );
  for (const name of ["browser-review", "live-canary"]) {
    const installs = Object.values(workflow(name).jobs)
      .flatMap((job) => job.steps)
      .filter((step) => step.run?.includes("npm install --global"));
    expect(installs).toHaveLength(1);
    expect(installs[0]?.run).toContain("scripts/harness-versions.json");
    expect(installs[0]?.run).not.toMatch(/@\d+\.\d+\.\d+/);
  }
});
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
// @req R-DASH-07
it("schedules the live browser review and keeps provider credentials out of fork jobs and artifacts", () => {
  const config = workflow("browser-review");
  scheduleSchema.parse(config.on.schedule);
  expect(config.on).toHaveProperty("workflow_dispatch");
  expect(pathTriggerSchema.parse(config.on.pull_request).paths).toContain(
    "apps/dashboard/**",
  );
  expect(config.permissions).toEqual({ contents: "read" });
  const review = config.jobs.review;
  expect(review?.if).toContain(
    "github.event.pull_request.head.repo.full_name == github.repository",
  );
  const credentialSteps =
    review?.steps.filter((step) => step.env?.ANTHROPIC_API_KEY) ?? [];
  expect(credentialSteps).toHaveLength(1);
  expect(credentialSteps[0]?.run).toContain("pnpm test:browser-agent");
  // Without the optional key the scheduled review skips with a notice instead of failing.
  expect(credentialSteps[0]?.run).toContain("::notice::Skipped");
  expect(credentialSteps[0]?.run).toContain("exit 0");
  expect(credentialSteps[0]?.run).not.toContain("exit 1");
  expect(
    review?.steps.find((step) => step.uses === "actions/upload-artifact@v4")
      ?.with?.path,
  ).toBe("test-results/browser-agent/report.json");
});
it("runs the live canary nightly and on every native adapter change, with read-only workflow permissions", () => {
  const config = workflow("live-canary");
  expect(config.on).not.toHaveProperty("push");
  scheduleSchema.parse(config.on.schedule);
  const paths = pathTriggerSchema.parse(config.on.pull_request).paths;
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
    "scripts/canary/**",
    "scripts/harness-versions.json",
    "apps/api/src/services/jobs.ts",
    "apps/api/src/routes/**",
    "apps/api/src/mcp/**",
    "fixtures/hooks/**",
  ])
    expect(paths).toContain(path);
  expect(config.permissions).toEqual({ contents: "read" });
  const canary = config.jobs.canary;
  expect(canary?.if).toContain(
    "github.event.pull_request.head.repo.full_name == github.repository",
  );
  expect(
    canary?.steps.some((step) => step.run?.includes("pnpm test:canary")),
  ).toBe(true);
  expect(
    canary?.steps.find((step) => step.uses === "actions/upload-artifact@v4")
      ?.with?.path,
  ).toBe(
    "test-results/live-canary/report.json\ntest-results/live-canary/*-mobile.png\n",
  );
});
// @req R-INF-08
it("publishes a signed multi-architecture image per green main commit with only the workflow token", () => {
  const config = workflow("release");
  expect(config.on.workflow_run).toMatchObject({
    workflows: ["CI"],
    branches: ["main"],
    types: ["completed"],
  });
  expect(config.on).toHaveProperty("workflow_dispatch");
  expect(config.permissions).toEqual({
    contents: "read",
    packages: "write",
    "id-token": "write",
  });
  expect(Object.keys(config.jobs)).toEqual(["image"]);
  const job = config.jobs.image;
  for (const condition of [
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.head_branch == 'main'",
    "github.event.workflow_run.head_repository.full_name == github.repository",
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
  ])
    expect(job?.if).toContain(condition);
  expect(
    job?.steps.find((step) => step.uses === "actions/checkout@v4")?.with?.ref,
  ).toBe("${{ github.event.workflow_run.head_sha || github.sha }}");
  const uses = job?.steps.map((step) => step.uses) ?? [];
  for (const action of [
    "docker/setup-qemu-action@v3",
    "docker/setup-buildx-action@v3",
    "docker/login-action@v3",
    "docker/build-push-action@v6",
    "sigstore/cosign-installer@v3",
  ])
    expect(uses).toContain(action);
  expect(
    job?.steps.find((step) => step.uses === "docker/login-action@v3")?.with,
  ).toMatchObject({
    registry: "ghcr.io",
    password: "${{ secrets.GITHUB_TOKEN }}",
  });
  const build = job?.steps.find(
    (step) => step.uses === "docker/build-push-action@v6",
  )?.with;
  expect(build).toMatchObject({
    context: ".",
    platforms: "linux/amd64,linux/arm64",
    push: true,
  });
  const tags = z.string().parse(build?.tags).trim().split("\n");
  expect(tags).toEqual([
    "${{ steps.release.outputs.image }}:sha-${{ steps.release.outputs.version }}",
    "${{ steps.release.outputs.image }}:stable",
  ]);
  expect(z.string().parse(build?.labels)).toContain(
    "org.opencontainers.image.source=",
  );
  // The revision and created stamps travel as build arguments so the Dockerfile writes the
  // labels once, for this workflow and for an on-host build alike (R-INF-14).
  const buildArgs = z.string().parse(build?.["build-args"]);
  for (const argument of [
    "AGENTCOMMONS_VERSION=${{ steps.release.outputs.version }}",
    "AGENTCOMMONS_REVISION=${{ github.event.workflow_run.head_sha || github.sha }}",
    "AGENTCOMMONS_CREATED=${{ steps.release.outputs.created }}",
  ])
    expect(buildArgs).toContain(argument);
  const release = job?.steps.find((step) =>
    step.run?.includes("GITHUB_OUTPUT"),
  );
  expect(release?.run).toContain(
    "ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/agentcommons",
  );
  expect(release?.run).toContain("git rev-parse --short=12 HEAD");
  expect(
    job?.steps.some((step) => step.run?.startsWith("cosign sign --yes ")),
  ).toBe(true);
  // No cloud account: no AWS action, no configured secret beyond the workflow's own token.
  expect(uses.some((action) => action?.startsWith("aws-actions/"))).toBe(false);
  const text = readFileSync(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  expect(text).not.toMatch(/aws|pulumi/i);
  expect(text.match(/secrets\.[A-Z_]+/g)).toEqual(["secrets.GITHUB_TOKEN"]);
});
