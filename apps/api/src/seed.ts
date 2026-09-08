import { PrismaClient } from "@agentcommons/db";
import {
  bootstrap,
  bootstrapInputSchema,
  operatorArguments,
} from "./auth/bootstrap.js";
import { authEnvironment } from "./auth/environment.js";
const env = authEnvironment(process.env);
const prisma = new PrismaClient({ datasourceUrl: env.databaseUrl });
try {
  const { result } = await bootstrap(
    prisma,
    env.auth,
    bootstrapInputSchema.parse(operatorArguments("seed")),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
