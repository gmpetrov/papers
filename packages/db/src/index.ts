import { PrismaClient } from "../generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
export { Prisma } from "../generated/client";
export type Database = PrismaClient;
export function createDatabase(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    }),
  });
}
