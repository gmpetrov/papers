import { Suspense } from "react";
import { OAuthFlow } from "@/components/oauth-flow";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading workspaces…</p>}>
      <OAuthFlow mode="organization" />
    </Suspense>
  );
}
