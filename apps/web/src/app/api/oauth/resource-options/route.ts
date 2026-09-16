import { withRuntime } from "@/lib/server";
import { z } from "zod";
const querySchema = z.object({
  organizationId: z.string().min(1).max(256),
  kind: z.enum(["inboxes", "phone-numbers"]),
  cursor: z.string().max(256).optional(),
});
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success)
    return Response.json(
      { error: { message: "Invalid resource request" } },
      { status: 400, headers },
    );
  return withRuntime(async (r) => {
    const session = await r.auth.api.getSession({ headers: request.headers });
    if (!session || session.user.banned || session.session.impersonatedBy)
      return Response.json(
        { error: { message: "Use your own signed-in session" } },
        { status: 401, headers },
      );
    const { organizationId, kind, cursor } = query.data;
    const member = await r.db.member.findFirst({
      where: { organizationId, userId: session.user.id },
      include: { user: true },
    });
    if (!member || member.user.banned)
      return Response.json(
        { error: { message: "Workspace access required" } },
        { status: 403, headers },
      );
    const where = { organizationId, ...(cursor ? { id: { gt: cursor } } : {}) };
    const rows =
      kind === "inboxes"
        ? await r.db.inbox.findMany({
            where,
            orderBy: { id: "asc" },
            take: 51,
            select: { id: true, name: true, address: true, status: true },
          })
        : await r.db.phoneNumber.findMany({
            where,
            orderBy: { id: "asc" },
            take: 51,
            select: { id: true, phoneNumber: true, status: true },
          });
    return Response.json(
      {
        data: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      },
      { headers },
    );
  }, request);
}
