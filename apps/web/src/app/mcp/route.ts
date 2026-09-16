import { withRuntime } from "@/lib/server";
import { handleMcp, toolScopes } from "@agentinfra/mcp";
import { Papers } from "@agentinfra/sdk";
async function handle(request: Request) {
  return withRuntime(async (r) => {
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    const check = await r.mcpApi.fetch(
      new Request(new URL("/v1/me", request.url), { headers }),
    );
    if (!check.ok) {
      if (check.status === 401)
        check.headers.set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", r.auth.options.baseURL as string).href}"`,
        );
      return check;
    }
    if (request.method === "POST") {
      const body = await request
        .clone()
        .json()
        .catch(() => null);
      const required =
        body?.method === "tools/call" && typeof body.params?.name === "string"
          ? toolScopes[body.params.name]
          : undefined;
      const principal = await check.json();
      const alternatives = Array.isArray(required)
        ? required
        : required
          ? [required]
          : [];
      if (
        alternatives.length &&
        !alternatives.some((scope) => principal.scopes.includes(scope))
      )
        return Response.json(
          {
            jsonrpc: "2.0",
            id: body.id ?? null,
            error: {
              code: -32001,
              message: `Requires one of: ${alternatives.join(", ")}`,
            },
          },
          {
            status: 403,
            headers: {
              "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${alternatives[0]}", resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", r.auth.options.baseURL as string).href}"`,
            },
          },
        );
    }
    const client = new Papers({
      apiKey: "unused",
      baseUrl: new URL(request.url).origin,
      signal: request.signal,
      fetch: async (input, init) => {
        const forwarded = new Headers(init?.headers);
        // Keep SDK content/idempotency headers, but use only the authenticated
        // caller's bearer token for the in-process API request.
        forwarded.delete("authorization");
        const authorization = headers.get("authorization");
        if (authorization) forwarded.set("authorization", authorization);
        const origin = headers.get("origin");
        if (origin) forwarded.set("origin", origin);
        // Workerd rejects redirect:"error"; manual preserves no-follow behavior.
        return r.mcpApi.fetch(
          new Request(input, {
            ...init,
            headers: forwarded,
            redirect: "manual",
          }),
        );
      },
    });
    return handleMcp(
      request,
      (path, method = "GET", body, key) =>
        client.request(
          path,
          method,
          body,
          key ? { idempotencyKey: key } : undefined,
        ),
      (id, maxBytes) => client.attachments.download(id, { maxBytes }),
    );
  });
}
export { handle as GET, handle as POST, handle as DELETE };
