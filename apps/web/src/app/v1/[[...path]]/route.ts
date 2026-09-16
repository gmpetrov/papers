import { withRuntime } from "@/lib/server";
const handle = (request: Request) =>
  withRuntime(async (r) => r.api.fetch(request));
export {
  handle as GET,
  handle as POST,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
};
