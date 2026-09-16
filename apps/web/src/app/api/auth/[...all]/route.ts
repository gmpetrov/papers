import { withRuntime } from "@/lib/server";
const handle = (request: Request) =>
  withRuntime((r) => r.auth.handler(request), request);
export { handle as GET, handle as POST };
