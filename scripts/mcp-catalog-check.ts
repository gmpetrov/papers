import { handleMcp } from "../apps/mcp/src/index";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const noCalls = async (): Promise<never> => {
  throw new Error("Catalog generation must not execute tools");
};
const response = await handleMcp(
  new Request("https://papers.example/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }),
  noCalls,
  noCalls,
);
const { result } = (await response.json()) as {
  result: {
    tools: Array<{
      name: string;
      title?: string;
      annotations?: Record<string, unknown>;
    }>;
  };
};
for (const tool of result.tools) {
  assert.ok(tool.title, `${tool.name} needs a title`);
  for (const flag of ["readOnlyHint", "destructiveHint", "openWorldHint"])
    assert.equal(
      typeof tool.annotations?.[flag],
      "boolean",
      `${tool.name}: ${flag}`,
    );
}
await writeFile(
  "integrations/tool-catalog.json",
  JSON.stringify(
    {
      status: "generated_local_metadata_not_client_acceptance",
      tools: result.tools,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Checked titles and review annotations on ${result.tools.length} MCP tools. No tools executed.`,
);
