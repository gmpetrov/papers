import { defineConfig } from "prisma/config";
import { migrationDatabaseUrl } from "./migration-url";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: migrationDatabaseUrl(),
  },
});
