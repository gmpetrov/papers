import { createServer } from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
let polls = 0;
const server = createServer((req, res) => {
  assert.equal(req.headers.authorization, "Bearer fixture");
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/operations/test")
    res.end(
      JSON.stringify({
        id: "test",
        status: ++polls === 1 ? "unknown" : "completed",
      }),
    );
  else if (req.url?.startsWith("/v1/events"))
    res.end(
      JSON.stringify({
        data: [
          {
            id: "checkpoint",
            type: "email.received",
            resourceId: "message",
            createdAt: new Date().toISOString(),
          },
        ],
        nextCursor: "checkpoint",
      }),
    );
  else {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
function run(args, watch = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["packages/cli/dist/index.js", "--base-url", origin, ...args],
      { env: { ...process.env, PAPERS_API_KEY: "fixture" } },
    );
    let output = "",
      errors = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI did not finish"));
    }, 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (watch && output.includes("\n")) child.kill("SIGINT");
    });
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`CLI exit ${code}: ${errors}`));
      else resolve(output);
    });
  });
}
try {
  assert.equal(
    JSON.parse(
      await run([
        "operations",
        "wait",
        "test",
        "--interval",
        "1",
        "--timeout",
        "5",
      ]),
    ).status,
    "completed",
  );
  assert.equal(polls, 2);
  const event = JSON.parse(
    (await run(["events", "watch", "--interval", "1"], true)).trim(),
  );
  assert.equal(event.cursor, "checkpoint");
  assert.equal(event.event.type, "email.received");
  console.log(
    "Built CLI operation polling, event JSON, and SIGINT shutdown passed.",
  );
} finally {
  server.close();
}
