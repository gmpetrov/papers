import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  stat,
  access,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const directory = await mkdtemp(join(tmpdir(), "papers-attachments-"));
const bytes = Buffer.from([0, 255, 128, 10]);
let requests = 0;
const server = createServer((request, response) => {
  requests++;
  assert.equal(request.headers.authorization, "Bearer fixture");
  if (request.url === "/v1/attachments/pending/download") {
    response.writeHead(409, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: { code: "attachment_not_ready", message: "Not ready" },
      }),
    );
  } else {
    assert.equal(request.url, "/v1/attachments/file%2Fid/download");
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.write(bytes.subarray(0, 2));
    response.end(bytes.subarray(2));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
function run(id, output, limit = "26214400") {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "packages/cli/dist/index.js",
        "--base-url",
        origin,
        "attachments",
        "download",
        id,
        "--output",
        output,
        "--max-bytes",
        limit,
      ],
      { env: { ...process.env, PAPERS_API_KEY: "fixture" } },
    );
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI timed out"));
    }, 10000);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
try {
  const output = join(directory, "download.bin");
  const success = await run("file/id", output);
  assert.equal(success.code, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout), {
    attachmentId: "file/id",
    path: output,
    bytes: 4,
  });
  assert.deepEqual(await readFile(output), bytes);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  await writeFile(output, "keep");
  assert.equal((await run("file/id", output)).code, 1);
  assert.equal(await readFile(output, "utf8"), "keep");
  const link = join(directory, "link");
  await symlink(output, link);
  assert.equal((await run("file/id", link)).code, 1);
  assert.equal(await readFile(output, "utf8"), "keep");
  for (const [id, limit, error] of [
    ["file/id", "2", "attachment_too_large"],
    ["pending", "26214400", "attachment_not_ready"],
  ]) {
    const target = join(directory, error);
    const failure = await run(id, target, limit);
    assert.equal(failure.code, 1);
    assert.equal(JSON.parse(failure.stderr).error.code, error);
    await assert.rejects(access(target));
  }
  const before = requests;
  assert.equal(
    (await run("file/id", join(directory, "invalid"), "1.5")).code,
    1,
  );
  assert.equal(requests, before);
  console.log(
    "Built CLI attachment bytes, authentication, private file mode, overwrite/symlink protection, pending errors, and size limits passed.",
  );
} finally {
  server.close();
  await rm(directory, { recursive: true, force: true });
}
