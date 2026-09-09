import {
  recover,
  recoverArguments,
  runOperatorCommand,
} from "./auth/bootstrap.js";

await runOperatorCommand((prisma, auth) =>
  recover(prisma, auth, recoverArguments().email),
);
