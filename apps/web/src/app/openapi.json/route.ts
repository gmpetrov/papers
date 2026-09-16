import { createOpenApiDocument } from "@agentinfra/contracts/openapi";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return Response.json(
    createOpenApiDocument(
      new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin,
    ),
    {
      headers: { "Cache-Control": "public, max-age=300" },
    },
  );
}
