/** CLI-only connection: session advisory locks must bypass transaction poolers. */
export function migrationDatabaseUrl(env = process.env): string {
  const value =
    env.DIRECT_URL ??
    env.DATABASE_URL ??
    "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra";
  const url = new URL(value);
  // Prisma Postgres uses identical credentials for its direct and pooled hosts.
  // Other providers must supply DIRECT_URL explicitly when using a pooler.
  if (url.hostname === "pooled.db.prisma.io") {
    url.hostname = "db.prisma.io";
    return url.href;
  }
  return value;
}
