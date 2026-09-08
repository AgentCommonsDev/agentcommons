import {
  createMigrationClient,
  migrationConfigSchema,
  runMigration,
} from "./migration.js";
const config = migrationConfigSchema.parse(process.env);
await runMigration(createMigrationClient(config));
console.log("Database migration completed.");
