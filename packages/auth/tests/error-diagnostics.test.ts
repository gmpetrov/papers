import { expect, it } from "vitest";
import { authErrorDiagnostics } from "../src/error-diagnostics";
it("preserves nested database error codes without leaking query or account data", () => {
  const error = Object.assign(
    new Error("SQL SELECT secret@example.test password"),
    {
      code: "P2010",
      meta: {
        driverAdapterError: {
          cause: {
            kind: "postgres",
            originalCode: "53300",
            originalMessage: "too many connections for secret@example.test",
          },
        },
      },
    },
  );
  const result = authErrorDiagnostics(error);
  expect(result).toContainEqual(expect.objectContaining({ code: "P2010" }));
  expect(result).toContainEqual(
    expect.objectContaining({ code: "53300", category: "connection_limit" }),
  );
  expect(JSON.stringify(result)).not.toMatch(/secret|SELECT|password/);
});
it("handles cyclic causes and classifies connection timeouts", () => {
  const error = Object.assign(
    new Error("Connection terminated due to connection timeout"),
    { cause: {} },
  );
  error.cause = error;
  expect(authErrorDiagnostics(error)).toEqual([
    { name: "Error", code: undefined, kind: undefined, category: "timeout" },
  ]);
});
