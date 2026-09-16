import { withRuntime } from "@/lib/server";
export async function GET() {
  try {
    return await withRuntime(async (r) => {
      await r.db.$queryRaw`SELECT 1`;
      return Response.json({
        status: "ok",
        database: "connected",
        phone: process.env.TELNYX_STATUS ?? "under_review",
      });
    });
  } catch (error) {
    console.error("Health check failed", {
      name: error instanceof Error ? error.name : "unknown",
      code:
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined,
      stack:
        error instanceof Error
          ? error.stack?.split("\n").slice(1).join("\n")
          : undefined,
    });
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
