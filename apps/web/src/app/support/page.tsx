import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { withRuntime } from "@/lib/server";
import { Support } from "@/components/support";

export const dynamic = "force-dynamic";
export default async function SupportPage() {
  const requestHeaders = await headers();
  const session = await withRuntime((r) =>
    r.auth.api.getSession({ headers: requestHeaders }),
  );
  if (!session) redirect("/login?next=%2Fsupport");
  if (session.user.role !== "admin" || session.session.impersonatedBy)
    redirect("/dashboard");
  return <Support currentUserId={session.user.id} />;
}
