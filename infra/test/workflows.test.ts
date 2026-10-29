import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const stepSchema = z.object({
  id: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
  if: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});
type Step = z.infer<typeof stepSchema>;
// Third-party actions are written `owner/name@v<major>` and Dependabot bumps the major, so
// assertions name the action and accept whichever major the workflow runs.
const actionReference = /^[\w.-]+\/[\w.-]+@v\d+$/;
function actionName(step: Step) {
  return step.uses?.replace(/@v\d+$/, "");
}
function usesAction(name: string) {
  return (step: Step) => actionName(step) === name;
}
const compositeActionSchema = z.object({
  runs: z.object({ steps: z.array(stepSchema) }),
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

it("references every third-party action as owner/name at a major version tag", () => {
  const steps = readdirSync(
    new URL("../../.github/workflows/", import.meta.url),
  )
    .filter((file) => file.endsWith(".yml"))
    .flatMap((file) => Object.values(workflow(file.slice(0, -4)).jobs))
    .flatMap((job) => job.steps);
  const setup = compositeActionSchema.parse(
    parse(
      readFileSync(
        new URL("../../.github/actions/setup/action.yml", import.meta.url),
        "utf8",
      ),
    ) as unknown,
  ).runs.steps;
  const references = [...steps, ...setup].flatMap((step) =>
    step.uses === undefined || step.uses.startsWith("./") ? [] : [step.uses],
  );
  expect(references.length).toBeGreaterThan(0);
  for (const reference of references)
    expect(reference).toMatch(actionReference);
});
it("sets up every job through the shared composite action right after checkout", () => {
  for (const name of workflowNames)
    for (const job of Object.values(workflow(name).jobs)) {
      const actions = job.steps.map(actionName);
      const checkout = actions.indexOf("actions/checkout");
      expect(checkout).toBeGreaterThanOrEqual(0);
      expect(actions[checkout + 1]).toBe("./.github/actions/setup");
      expect(actions).not.toContain("pnpm/action-setup");
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
    config.jobs.preview?.steps.find(usesAction("pulumi/actions"))?.with
      ?.command,
  ).toBe("preview");
  expect(
    config.jobs.preview?.steps.find(
      usesAction("aws-actions/configure-aws-credentials"),
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
    config.jobs.deploy?.steps.find(usesAction("actions/checkout"))?.with?.ref,
  ).toBe("${{ github.event.workflow_run.head_sha || github.sha }}");
  expect(
    config.jobs.deploy?.steps.find(usesAction("pulumi/actions"))?.with?.command,
  ).toBe("up");
  expect(
    config.jobs.deploy?.steps.find((step) => step.run === "pnpm verify")?.if,
  ).toContain("github.event_name == 'workflow_dispatch'");
});
// @req R-INF-03
it("skips preview and deploy with a notice when the run has no AWS region or role", () => {
  const config = workflow("deploy");
  for (const [job, role] of [
    ["preview", "AWS_PREVIEW_ROLE_ARN"],
    ["deploy", "AWS_DEPLOY_ROLE_ARN"],
  ] as const) {
    const [check, ...rest] = config.jobs[job]?.steps ?? [];
    // Environment-scoped variables bind after the job-level `if`, so the check is the first step
    // and reads them as step environment. Dependabot runs and unconfigured environments have none.
    expect(check?.id).toBe("aws");
    expect(check?.uses).toBeUndefined();
    expect(check?.env).toEqual({
      AWS_REGION: "${{ vars.AWS_REGION }}",
      AWS_ROLE_ARN: `\${{ vars.${role} }}`,
    });
    expect(check?.run).toContain(
      '[ -z "$AWS_REGION" ] || [ -z "$AWS_ROLE_ARN" ]',
    );
    expect(check?.run).toContain(
      `::notice::Skipped: Set AWS_REGION and ${role}`,
    );
    expect(check?.run).toContain("exit 0");
    expect(check?.run).not.toContain("exit 1");
    expect(check?.run).toContain(`echo 'configured=false' >> "$GITHUB_OUTPUT"`);
    expect(check?.run).toContain(`echo 'configured=true' >> "$GITHUB_OUTPUT"`);
    // Every other step, checkout included, waits on that output: a skipped job prints the notice
    // and nothing else.
    expect(rest.length).toBeGreaterThanOrEqual(4);
    for (const step of rest)
      expect(step.if).toContain("steps.aws.outputs.configured == 'true'");
  }
  // OIDC or nothing: the pipeline holds no AWS keys and no secret beyond the Pulumi token.
  const text = readFileSync(
    new URL("../../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  expect(text).not.toMatch(
    /aws-access-key-id|aws-secret-access-key|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/,
  );
  expect(new Set(text.match(/secrets\.[A-Z_]+/g))).toEqual(
    new Set(["secrets.PULUMI_ACCESS_TOKEN"]),
  );
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
    review?.steps.find(usesAction("actions/upload-artifact"))?.with?.path,
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
  // The stale-bundle swap (R-CAP-16) needs a manifest the built bundle trusts: one key per
  // run, pinned at build time and signing the served manifest (ADR 0102).
  const build = canary?.steps.find((step) =>
    step.run?.includes("pnpm build"),
  )?.run;
  expect(build).toContain("AGENTCOMMONS_HOOK_RELEASE_KEYS=");
  expect(build).toContain(
    'node packages/hook/sign.ts "$key" apps/api/public/hook/manifest.json',
  );
  expect(
    canary?.steps.find(usesAction("actions/upload-artifact"))?.with?.path,
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
  expect(job?.steps.find(usesAction("actions/checkout"))?.with?.ref).toBe(
    "${{ github.event.workflow_run.head_sha || github.sha }}",
  );
  const actions = job?.steps.map(actionName) ?? [];
  for (const action of [
    "docker/setup-qemu-action",
    "docker/setup-buildx-action",
    "docker/login-action",
    "docker/build-push-action",
    "sigstore/cosign-installer",
  ])
    expect(actions).toContain(action);
  expect(
    job?.steps.find(usesAction("docker/login-action"))?.with,
  ).toMatchObject({
    registry: "ghcr.io",
    password: "${{ secrets.GITHUB_TOKEN }}",
  });
  const build = job?.steps.find(usesAction("docker/build-push-action"))?.with;
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
  // The signer the host updater's verifier (scripts/self-host/lib.sh) expects.
  expect(
    job?.steps.find(usesAction("sigstore/cosign-installer"))?.with,
  ).toEqual({ "cosign-release": "v2.6.5" });
  // No cloud account: no AWS action, no secret beyond the workflow's own token and the
  // hook signing key of the release environment.
  expect(actions.some((action) => action?.startsWith("aws-actions/"))).toBe(
    false,
  );
  const text = readFileSync(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  expect(text).not.toMatch(/aws|pulumi/i);
  expect(new Set(text.match(/secrets\.[A-Z_]+/g))).toEqual(
    new Set(["secrets.GITHUB_TOKEN", "secrets.HOOK_SIGNING_KEY"]),
  );
});
// @req R-CAP-30
it("signs the hook manifest inside the release image build with the release environment's key, and refuses to release without it", () => {
  const job = workflow("release").jobs.image;
  // An environment secret reaches only jobs that environment admits, never a branch or
  // pull-request workflow (ADR 0102).
  expect(job?.environment).toBe("release");
  const guard = job?.steps[0];
  expect(guard?.env).toEqual({
    HOOK_SIGNING_KEY: "${{ secrets.HOOK_SIGNING_KEY }}",
  });
  expect(guard?.run).toContain('[ -n "$HOOK_SIGNING_KEY" ]');
  expect(guard?.run).toContain("exit 1");
  const build = job?.steps.find(usesAction("docker/build-push-action"))?.with;
  expect(z.string().parse(build?.secrets).trim()).toBe(
    "hook_signing_key=${{ secrets.HOOK_SIGNING_KEY }}",
  );
  // The Dockerfile mounts it for one step that runs Node on sign.ts and nothing else.
  const dockerfile = readFileSync(
    new URL("../../Dockerfile", import.meta.url),
    "utf8",
  );
  const steps = dockerfile
    .split(/\n(?=[A-Z]+ |#)/)
    .filter((instruction) => instruction.includes("hook_signing_key"));
  expect(steps).toHaveLength(1);
  expect(steps[0]).toMatch(/^RUN --mount=type=secret,id=hook_signing_key /);
  expect(steps[0]).toContain(
    "node packages/hook/sign.ts /run/secrets/hook_signing_key apps/api/public/hook/manifest.json",
  );
  expect(steps[0]).not.toMatch(/pnpm|npx|tsx/);
});
