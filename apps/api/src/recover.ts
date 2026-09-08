import { PrismaClient } from "@agentcommons/db";
import { operatorArguments, recover } from "./auth/bootstrap.js";
import { authEnvironment } from "./auth/environment.js";
const env = authEnvironment(process.env);
const prisma = new PrismaClient({ datasourceUrl: env.databaseUrl });
try {
  const { email } = operatorArguments("recover");
  const { result } = await recover(prisma, env.auth, email);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
