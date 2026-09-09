import {
  bootstrap,
  runOperatorCommand,
  seedArguments,
} from "./auth/bootstrap.js";

await runOperatorCommand((prisma, auth) =>
  bootstrap(prisma, auth, seedArguments()),
);
