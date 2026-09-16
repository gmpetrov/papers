import { PrismaClient } from "../generated-edge/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Database } from "./index";

// Workerd requires a statically imported Wasm module, unlike the Node client.
export function createDatabase(connectionString: string): Database {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    }),
    // Both clients are generated from the same schema. Prisma's private runtime
    // brands differ between targets, so normalize the type at this boundary.
  }) as unknown as Database;
}
