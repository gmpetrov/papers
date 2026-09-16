import { withRuntime } from "@/lib/server";

export async function GET(request: Request) {
  return withRuntime((r) => r.auth.handler(request));
}
