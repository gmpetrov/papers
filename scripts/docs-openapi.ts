import { writeFileSync } from "node:fs";
import { createOpenApiDocument } from "../packages/contracts/src/openapi";

// Use the same runtime contracts as /openapi.json. Keep the docs snapshot
// reproducible without requiring a running server or production credentials.
const document = createOpenApiDocument("https://www.papers.bot");
document.info.description =
  "Email, SMS, and workspace resources for Papers. Authenticate resource requests with a scoped API key or OAuth token. Administrative endpoints require a human session.";
const groups: Record<string, string> = {
  inboxes: "Inboxes",
  messages: "Email",
  attachments: "Attachments",
  "phone-numbers": "Phone numbers",
  sms: "SMS",
  events: "Events",
  operations: "Operations",
  approvals: "Approvals",
  "api-keys": "API keys",
  connections: "Connections",
  "webhook-endpoints": "Webhook endpoints",
  workspace: "Workspace",
  billing: "Billing",
};
for (const [path, methods] of Object.entries(document.paths)) {
  // Legacy agent records and signed-URL redemption are not integration entry points.
  if (
    path.startsWith("/agents") ||
    path.startsWith("/attachment-media/") ||
    /^\/attachments\/[^/]+\/content$/.test(path)
  ) {
    delete document.paths[path];
    continue;
  }
  for (const operation of Object.values(methods)) {
    (operation as Record<string, unknown>).tags = [
      groups[path.split("/")[1]] ?? "Identity",
    ];
  }
}
const order = [
  "Identity",
  "Inboxes",
  "Email",
  "Attachments",
  "Phone numbers",
  "SMS",
  "Events",
  "Operations",
  "Approvals",
  "API keys",
  "Connections",
  "Webhook endpoints",
  "Workspace",
  "Billing",
];
document.paths = Object.fromEntries(
  Object.entries(document.paths).sort(([, a], [, b]) => {
    const tag = (methods: Record<string, unknown>) =>
      (Object.values(methods)[0] as { tags: string[] }).tags[0];
    return order.indexOf(tag(a)) - order.indexOf(tag(b));
  }),
);
writeFileSync(
  new URL("../apps/docs/openapi.json", import.meta.url),
  JSON.stringify(document, null, 2) + "\n",
);
console.log("Generated Papers documentation API reference");
