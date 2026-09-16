"use client";
import { createAuthClient } from "better-auth/react";
import { organizationClient, adminClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
export const authClient = createAuthClient({
  plugins: [
    organizationClient({ teams: { enabled: true } }),
    adminClient(),
    oauthProviderClient(),
  ],
});
// Consent pages attach the explicitly selected workspace before navigating.
export const oauthFlowClient = createAuthClient({
  disableDefaultFetchPlugins: true,
  plugins: [oauthProviderClient()],
});
