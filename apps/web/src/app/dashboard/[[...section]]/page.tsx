import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { withRuntime } from "@/lib/server";
import { Dashboard } from "@/components/dashboard";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  if ((await params).section?.[0] === "agents") redirect("/dashboard/inboxes");
  const h = await headers();
  const data = await withRuntime(async (r) => {
    const session = await r.auth.api.getSession({ headers: h });
    if (!session) return null;
    const memberships = await r.db.member.findMany({
      where: { userId: session.user.id },
      include: { organization: true },
    });
    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role ?? "user",
      },
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
      })),
      activeOrganizationId: session.session.activeOrganizationId ?? null,
      impersonatedBy: session.session.impersonatedBy ?? null,
    };
  });
  if (!data)
    redirect(
      `/login?next=${encodeURIComponent("/dashboard/" + ((await params).section?.join("/") ?? ""))}`,
    );
  return (
    <Dashboard
      key={data.activeOrganizationId}
      {...data}
      section={(await params).section?.[0] ?? "overview"}
    />
  );
}
