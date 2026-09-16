import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), "papers-package-check-"));
try {
  const tarballs = [];
  for (const name of ["sdk", "cli"]) {
    const manifest = JSON.parse(
      await readFile(
        join(
          root,
          "packages",
          name === "sdk" ? "sdk-typescript" : "cli",
          "package.json",
        ),
        "utf8",
      ),
    );
    tarballs.push(
      join(directory, `agentinfra-${name}-${manifest.version}.tgz`),
    );
    await exec(
      "pnpm",
      [
        "--filter",
        `@agentinfra/${name}`,
        "pack",
        "--pack-destination",
        directory,
      ],
      { cwd: root },
    );
  }
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await exec(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs],
    { cwd: directory },
  );
  const { stdout } = await exec(
    join(directory, "node_modules/.bin/papers"),
    ["--help"],
    { cwd: directory },
  );
  assert.match(stdout, /inboxes/);
  await writeFile(
    join(directory, "check.mts"),
    `import { Papers } from "@agentinfra/sdk";
const client = new Papers({ apiKey: "fixture" });
const me = await client.me();
const remaining: number = me.sendLimits.email.remaining;
const inboxes = client.iterateInboxes({ limit: 2 });
const numbers = client.iteratePhoneNumbers({ cursor: "saved" });
for await (const inbox of inboxes) {
  const messageCount: number = inbox._count.messages;
  void messageCount;
}
for await (const number of numbers) {
  const monthlyCost: string | null = number.monthlyCost;
  void monthlyCost;
}
void [remaining, inboxes, numbers];
`,
  );
  await exec(
    process.execPath,
    [
      resolve("node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--module",
      "NodeNext",
      "--target",
      "ES2022",
      "check.mts",
    ],
    { cwd: directory },
  );
  await writeFile(
    join(directory, "smoke.mjs"),
    `
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Papers } from "@agentinfra/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  assert.equal(req.headers.authorization, "Bearer fixture");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ data: [{ id: "inbox", name: "Fixture", address: "fixture@example.test" }], nextCursor: null }));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const baseUrl = "http://127.0.0.1:" + server.address().port;
const client = new Client({ name: "package-check", version: "1.0.0" });
try {
  const sdk = new Papers({ apiKey: "fixture", baseUrl });
  const rows = [];
  for await (const inbox of sdk.iterateInboxes({ limit: 2 })) rows.push(inbox.id);
  assert.deepEqual(rows, ["inbox"]);
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["node_modules/@agentinfra/cli/dist/index.js", "mcp"], env: { PATH: process.env.PATH, PAPERS_API_KEY: "fixture", PAPERS_BASE_URL: baseUrl }, stderr: "pipe" }));
  assert.ok((await client.listTools()).tools.some(tool => tool.name === "list_inboxes"));
  const result = await client.callTool({ name: "list_inboxes", arguments: { cursor: "saved/+&", limit: 2 } });
  assert.ok(!result.isError);
  assert.ok(requests.some(url => url.includes("cursor=saved%2F%2B%26&limit=2")));
} finally { await client.close(); await new Promise(resolve => server.close(resolve)); }
console.log("Installed SDK runtime, declarations, CLI executable, and stdio MCP passed.");
`,
  );
  const smoke = await exec(process.execPath, ["smoke.mjs"], {
    cwd: directory,
    timeout: 30000,
  });
  process.stdout.write(smoke.stdout);
} finally {
  await rm(directory, { recursive: true, force: true });
}
