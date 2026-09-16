import { betterAuth } from "better-auth";
import { admin, organization, jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
export const auth = betterAuth({
  plugins: [
    admin(),
    organization({ teams: { enabled: true } }),
    jwt(),
    oauthProvider({ loginPage: "/login", consentPage: "/consent" }),
  ],
});
