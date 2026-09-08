import {
  DescribeTasksCommand,
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  type DescribeTasksCommandOutput,
  type RunTaskCommandOutput,
} from "@aws-sdk/client-ecs";
import { z } from "zod";

export const migrationConfigSchema = z.object({
  AWS_REGION: z.string().min(1),
  MIGRATION_CLUSTER: z.string().min(1),
  MIGRATION_TASK_DEFINITION: z.string().min(1),
  MIGRATION_SUBNETS: z
    .string()
    .transform((value, context) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        context.addIssue({
          code: "custom",
          message: "Expected a JSON subnet array",
        });
        return z.NEVER;
      }
    })
    .pipe(z.array(z.string().min(1)).min(1)),
  MIGRATION_SECURITY_GROUP: z.string().min(1),
});
export type MigrationConfig = z.infer<typeof migrationConfigSchema>;
export interface MigrationClient {
  run: () => Promise<RunTaskCommandOutput>;
  describe: (taskArn: string) => Promise<DescribeTasksCommandOutput>;
  stop: (taskArn: string) => Promise<unknown>;
}
export function createMigrationClient(
  config: MigrationConfig,
): MigrationClient {
  const client = new ECSClient({ region: config.AWS_REGION });
  return {
    run: () =>
      client.send(
        new RunTaskCommand({
          cluster: config.MIGRATION_CLUSTER,
          taskDefinition: config.MIGRATION_TASK_DEFINITION,
          launchType: "FARGATE",
          count: 1,
          platformVersion: "LATEST",
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: config.MIGRATION_SUBNETS,
              securityGroups: [config.MIGRATION_SECURITY_GROUP],
              assignPublicIp: "DISABLED",
            },
          },
        }),
      ),
    describe: (taskArn) =>
      client.send(
        new DescribeTasksCommand({
          cluster: config.MIGRATION_CLUSTER,
          tasks: [taskArn],
        }),
      ),
    stop: (taskArn) =>
      client.send(
        new StopTaskCommand({
          cluster: config.MIGRATION_CLUSTER,
          task: taskArn,
          reason: "Migration deployment gate timed out",
        }),
      ),
  };
}
export async function runMigration(
  client: MigrationClient,
  options: { poll: () => Promise<void>; attempts: number } = {
    poll: () => new Promise((resolve) => setTimeout(resolve, 5000)),
    attempts: 240,
  },
): Promise<void> {
  const launch = await client.run();
  const taskArn = launch.tasks?.[0]?.taskArn;
  if (
    (launch.failures?.length ?? 0) > 0 ||
    taskArn === undefined ||
    launch.tasks?.length !== 1
  ) {
    throw new Error("ECS did not start exactly one migration task.");
  }
  try {
    for (let attempt = 0; attempt < options.attempts; attempt++) {
      const status = await client.describe(taskArn);
      if ((status.failures?.length ?? 0) > 0)
        throw new Error("ECS could not describe the migration task.");
      const task = status.tasks?.[0];
      if (task?.lastStatus === "STOPPED") {
        const container = task.containers?.find(
          (value) => value.name === "migrate",
        );
        if (
          container?.exitCode !== 0 ||
          task.stopCode !== "EssentialContainerExited"
        ) {
          throw new Error(
            "Migration task failed. Inspect its CloudWatch migration log before retrying.",
          );
        }
        return;
      }
      await options.poll();
    }
    throw new Error("Migration task timed out.");
  } catch (error) {
    await client.stop(taskArn);
    throw error;
  }
}
