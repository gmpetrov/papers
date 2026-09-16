// Import only the binding types used by the generated CloudflareEnv. Loading
// all Worker globals would override browser DOM types in this Next.js app.
type R2Bucket = import("@cloudflare/workers-types").R2Bucket;
type Hyperdrive = import("@cloudflare/workers-types").Hyperdrive;
type Queue<Body = unknown> = import("@cloudflare/workers-types").Queue<Body>;
