/** Keep database error identifiers, never SQL, parameters, credentials or user data. */
export function authErrorDiagnostics(error: unknown) {
  const seen = new Set<object>();
  const errors: {
    name?: string;
    code?: string;
    kind?: string;
    category?: string;
  }[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 5)
      return;
    seen.add(value);
    const entry = value as Record<string, unknown>;
    const safe = (field: unknown) =>
      typeof field === "string" && /^[A-Za-z0-9_]{1,80}$/.test(field)
        ? field
        : undefined;
    const message =
      typeof entry.message === "string"
        ? entry.message
        : typeof entry.originalMessage === "string"
          ? entry.originalMessage
          : "";
    const category = /timeout|timed out/i.test(message)
      ? "timeout"
      : /too many.*connections|max.*connections|pool.*exhaust/i.test(message)
        ? "connection_limit"
        : /connection.*(closed|terminated|reset|refused)/i.test(message)
          ? "connection_failure"
          : undefined;
    const detail = {
      name: safe(entry.name),
      code: safe(entry.code ?? entry.originalCode),
      kind: safe(entry.kind),
      category,
    };
    if (Object.values(detail).some(Boolean)) errors.push(detail);
    for (const key of [
      "cause",
      "meta",
      "driverAdapterError",
      "originalError",
      "error",
    ])
      visit(entry[key], depth + 1);
  };
  visit(error);
  return errors;
}
