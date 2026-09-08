import { describe, expect, it, vi } from "vitest";
import {
  migrationConfigSchema,
  runMigration,
  type MigrationClient,
} from "../scripts/migration.js";

function client(overrides: Partial<MigrationClient> = {}): MigrationClient {
  return {
    run: vi.fn(() =>
      Promise.resolve({ $metadata: {}, tasks: [{ taskArn: "arn:task" }] }),
    ),
    describe: vi.fn(() =>
      Promise.resolve({
        $metadata: {},
        tasks: [
          {
            lastStatus: "STOPPED",
            stopCode: "EssentialContainerExited" as const,
            containers: [{ name: "migrate", exitCode: 0 }],
          },
        ],
      }),
    ),
    stop: vi.fn(() => Promise.resolve({})),
    ...overrides,
  };
}
const options = { poll: () => Promise.resolve(), attempts: 2 };
describe("migration gate", () => {
  // @req R-INF-02
  it("opens only after the migration container exits successfully", async () => {
    const sdk = client();
    await expect(runMigration(sdk, options)).resolves.toBeUndefined();
    expect(sdk.stop).not.toHaveBeenCalled();
  });
  // @req R-INF-02
  it.each([1, undefined])(
    "blocks a failed or missing exit code (%s)",
    async (exitCode) => {
      const sdk = client({
        describe: vi.fn(() =>
          Promise.resolve({
            $metadata: {},
            tasks: [
              {
                lastStatus: "STOPPED",
                stopCode: "EssentialContainerExited" as const,
                containers: [
                  {
                    name: "migrate",
                    ...(exitCode === undefined ? {} : { exitCode }),
                  },
                ],
              },
            ],
          }),
        ),
      });
      await expect(runMigration(sdk, options)).rejects.toThrow(
        "Migration task failed",
      );
      expect(sdk.stop).toHaveBeenCalledWith("arn:task");
    },
  );
  // @req R-INF-02
  it("blocks placement errors and timeouts, stopping timed out tasks", async () => {
    await expect(
      runMigration(
        client({
          run: () =>
            Promise.resolve({
              $metadata: {},
              failures: [{ reason: "NO_CAPACITY" }],
            }),
        }),
        options,
      ),
    ).rejects.toThrow("did not start");
    const sdk = client({
      describe: vi.fn(() =>
        Promise.resolve({ $metadata: {}, tasks: [{ lastStatus: "RUNNING" }] }),
      ),
    });
    await expect(runMigration(sdk, options)).rejects.toThrow("timed out");
    expect(sdk.stop).toHaveBeenCalledWith("arn:task");
  });
  it("rejects malformed network settings before launching", () => {
    expect(
      migrationConfigSchema.safeParse({
        AWS_REGION: "us-east-1",
        MIGRATION_CLUSTER: "cluster",
        MIGRATION_TASK_DEFINITION: "task",
        MIGRATION_SUBNETS: "{}",
        MIGRATION_SECURITY_GROUP: "sg-1",
      }).success,
    ).toBe(false);
  });
});
