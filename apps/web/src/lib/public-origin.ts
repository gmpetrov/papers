export const publicAppOrigin = new URL(
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
).origin;
