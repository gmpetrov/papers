import { oauthScopes } from "@agentinfra/auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await context.params;
  const resourcePath = path?.join("/") ?? "mcp";
  if (!["mcp", "v1"].includes(resourcePath))
    return new Response(null, { status: 404 });
  const origin = process.env.BETTER_AUTH_URL;
  if (!origin) return new Response(null, { status: 503 });
  return Response.json(
    {
      resource: new URL(`/${resourcePath}`, origin).href,
      authorization_servers: [new URL("/api/auth", origin).href],
      bearer_methods_supported: ["header"],
      scopes_supported: oauthScopes,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
