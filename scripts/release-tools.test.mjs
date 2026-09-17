import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPublished, releaseNotes } from "./release-state.mjs";

const info = { name: "papers-bot", version: "0.1.2" };
const response = (status, body) => async () =>
  new Response(JSON.stringify(body), { status });
test("missing versions require publication; registry outages fail closed", async () => {
  assert.equal(await isPublished("python", info, response(404, {})), false);
  await assert.rejects(isPublished("python", info, response(503, {})), /503/);
});
test("partial PyPI uploads remain retryable until both artifacts exist", async () => {
  const wheel = { filename: "papers_bot-0.1.2-py3-none-any.whl" };
  const sdist = { filename: "papers_bot-0.1.2.tar.gz" };
  assert.equal(
    await isPublished("python", info, response(200, { urls: [wheel] })),
    false,
  );
  assert.equal(
    await isPublished("python", info, response(200, { urls: [wheel, sdist] })),
    true,
  );
});
test("npm must contain the expected package and version", async () => {
  const sdk = { name: "@papers.bot/sdk", version: "0.1.2" };
  assert.equal(await isPublished("npm", sdk, response(200, sdk)), true);
  assert.equal(
    await isPublished("npm", sdk, response(200, { ...sdk, version: "0.1.1" })),
    false,
  );
});
test("release notes contain only the selected version and require an entry", () => {
  const directory = mkdtempSync(join(tmpdir(), "papers-changelog-"));
  try {
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      "# SDK\n\n## 0.1.2\n\n### Patch Changes\n\nNew fix.\n\n## 0.1.1\n\nOld fix.\n",
    );
    assert.equal(
      releaseNotes({ directory, version: "0.1.2" }),
      "### Patch Changes\n\nNew fix.",
    );
    assert.throws(
      () => releaseNotes({ directory, version: "0.1.3" }),
      /Missing changelog/,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});
