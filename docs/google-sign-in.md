# Google sign-in verification

Verified September 16, 2026 in the in-app browser against the development
Cloudflare tunnel, with Next.js and Better Auth running locally.

- The Papers login button redirected to Google's account chooser with PKCE and
  the configured `/api/auth/callback/google` callback.
- Google requested only OpenID, email and profile identity scopes.
- Selecting the work account and completing Google sign-in returned to the
  authenticated Papers dashboard.
- Created the empty **Papers integration checks** workspace through the dashboard.
- Signed out of Papers, then signed in with the same Google account again.
  The dashboard listed the existing verification workspace; selecting it restored
  its overview.
- A read-only database check found one matching user with verified email, one
  Google account link, and one owner membership in the verification workspace.

The verification workspace remains available. A later inbox lifecycle check
created one inbox and left it archived; no phone numbers were purchased.
The API-key form's daily inbox/number creation fields were inspected;
values above 10,000 and below zero were rejected inline. No API key was created,
no number was purchased, and no message was sent by this check.

This verifies initial and returning sign-in in the development environment.
Database-backed callback tests also pass for a provider cancellation and a
forged state: neither creates a user/session, and cancellation preserves the
original invitation destination on the login error URL. The error page was
checked in the browser and displays a retry message with enabled sign-in
controls. The Google request handler now clears its busy state after a rejected
request or thrown network error.

Existing-password-account linking, canceling consent in Google's actual UI,
Google identity/invitation combinations, and the deployed Workers callback
remain separate acceptance cases. This is not evidence of production Google
sign-in or third-party MCP client acceptance.
