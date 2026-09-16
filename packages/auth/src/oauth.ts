export const oauthScopes = [
  "offline_access",
  "agents:read",
  "inboxes:read",
  "inboxes:write",
  "email:send",
  "numbers:read",
  "numbers:provision",
  "numbers:release",
  "sms:read",
  "sms:send",
  "events:read",
];

// A storage transform supported by Better Auth; plaintext tokens never persist.
export async function hashOAuthToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
