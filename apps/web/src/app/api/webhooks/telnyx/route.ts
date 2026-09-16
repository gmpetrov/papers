import { withRuntime, providerEnv, wakeBackgroundJobs } from "@/lib/server";
import { ingestTelnyx, AppError } from "@agentinfra/core";
export async function POST(request: Request) {
  try {
    return await withRuntime(async (r) => {
      const result = await ingestTelnyx(r.db, providerEnv(), request);
      wakeBackgroundJobs();
      return Response.json(result);
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof AppError ? error.code : "webhook_unavailable" },
      { status: error instanceof AppError ? error.status : 503 },
    );
  }
}
