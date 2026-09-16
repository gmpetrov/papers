export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
    public details?: { approvalId: string },
  ) {
    super(message);
  }
}
export function assert(
  value: unknown,
  status: number,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new AppError(status, code, message);
}
export async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
