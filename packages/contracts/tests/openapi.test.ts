import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createOpenApiDocument } from "../src/openapi";
const doc = createOpenApiDocument("https://papers.example");
it("describes resource pages and their nullable cursors for generated clients", () => {
  for (const [path, name] of [
    ["/inboxes", "InboxPage"],
    ["/phone-numbers", "PhoneNumberPage"],
    ["/phone-numbers/{id}", "PhoneNumber"],
    ["/phone-numbers/available", "AvailableNumberResults"],
  ]) {
    const operation = doc.paths[path!]!.get as any;
    expect(
      operation.responses["200"].content["application/json"].schema.$ref,
    ).toBe(`#/components/schemas/${name}`);
  }
  const schemas = doc.components.schemas as any;
  for (const name of ["InboxPage", "PhoneNumberPage"]) {
    expect(schemas[name].required).toContain("nextCursor");
    expect(schemas[name].properties.nextCursor.anyOf).toContainEqual({
      type: "null",
    });
    expect(schemas[name].properties.data.type).toBe("array");
  }
  expect(schemas.PhoneNumberPage.required).toContain("status");
});
it("documents every implemented versioned route", () => {
  const source = readFileSync(
    new URL("../../core/src/index.ts", import.meta.url),
    "utf8",
  );
  const actual = [
    ...source.matchAll(/app\.(get|post|patch|delete)\(\s*"\/v1([^"\n]+)"/g),
  ]
    .map((m) => `${m[1]} ${m[2]!.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}")}`)
    .sort();
  const documented = Object.entries(doc.paths)
    .flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method} ${path}`),
    )
    .sort();
  expect(documented).toEqual(actual);
});
it("uses runtime request constraints and distinguishes session-only actions", () => {
  const send = doc.paths["/inboxes/{id}/messages"]!.post as any;
  expect(send.requestBody.content["application/json"].schema.required).toEqual([
    "to",
    "subject",
    "text",
  ]);
  expect(send.parameters).toContainEqual(
    expect.objectContaining({ name: "Idempotency-Key", required: true }),
  );
  expect((doc.paths["/api-keys"]!.post as any).security).toEqual([
    { sessionCookie: [] },
  ]);
  expect(doc.servers[0]!.url).toBe("https://papers.example/v1");
  const ids = Object.values(doc.paths).flatMap((methods) =>
    Object.values(methods).map((v: any) => v.operationId),
  );
  expect(new Set(ids).size).toBe(ids.length);
});

it("does not repeat parameters and gives approvals and SMS named response contracts", () => {
  for (const methods of Object.values(doc.paths))
    for (const operation of Object.values(methods) as any[]) {
      const keys = operation.parameters.map((p: any) => `${p.in}:${p.name}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  const approval = doc.paths["/approvals"]!.get as any;
  expect(
    approval.responses["200"].content["application/json"].schema.$ref,
  ).toBe("#/components/schemas/ApprovalPage");
  const sms = doc.paths["/sms/{id}"]!.get as any;
  expect(sms.responses["200"].content["application/json"].schema.$ref).toBe(
    "#/components/schemas/SmsDetail",
  );
  const schemas = doc.components.schemas as any;
  expect(
    schemas.Error.properties.error.properties.details.anyOf[0].properties
      .approvalId.type,
  ).toBe("string");
  expect(
    schemas.SmsDetail.properties.recipientOptOut.properties.status.enum,
  ).toEqual(["blocked", "not_blocked", "unknown"]);
  expect(schemas.Approval.properties.parameters.anyOf).toHaveLength(4);
});

it("documents synchronous inbox creation separately from asynchronous sends and purchases", () => {
  const create = doc.paths["/inboxes"]!.post as any;
  expect(create.parameters ?? []).not.toContainEqual(
    expect.objectContaining({ name: "Idempotency-Key" }),
  );
  const input = create.requestBody.content["application/json"].schema;
  expect(input.required).toEqual(["username"]);
  expect(input.properties).toHaveProperty("username");
  expect(input.properties).not.toHaveProperty("localPart");
  expect(Object.keys(create.responses).sort()).toEqual([
    "201",
    "429",
    "default",
  ]);
  const send = doc.paths["/inboxes/{id}/messages"]!.post as any;
  expect(Object.keys(send.responses).sort()).toEqual([
    "200",
    "201",
    "202",
    "429",
    "default",
  ]);
  expect(send.responses["201"].content["application/json"].schema.$ref).toBe(
    "#/components/schemas/EmailOperation",
  );
  const purchase = doc.paths["/phone-numbers"]!.post as any;
  expect(Object.keys(purchase.responses).sort()).toEqual([
    "200",
    "202",
    "429",
    "default",
  ]);
});
