// Local test fixture only; never deploy this unauthenticated notification endpoint.
export default {
  async fetch(request, env) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/wake")
      return new Response(null, { status: 404 });
    await env.JOBS_QUEUE.send({ version: 1, type: "background.wakeup" });
    return new Response(null, { status: 202 });
  },
};
