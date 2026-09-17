// Explicitly run by an operator: validates configs and writes/removes one synthetic R2 probe.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_readConfig } from "wrangler";
for (const app of ["web", "jobs"]) {
  for (const suffix of ["", ".production"]) {
    const path = `apps/${app}/wrangler${suffix}.jsonc`;
    const config = unstable_readConfig({ config: path });
    const binding = config.r2_buckets.find((b) => b.binding === "ATTACHMENTS");
    assert.equal(
      binding?.bucket_name,
      "papers",
      `Wrong attachment bucket: ${path}`,
    );
    assert(
      !binding.remote,
      `Local environments must not write production storage: ${path}`,
    );
  }
}
const run = (args) =>
  execFileSync("pnpm", ["exec", "wrangler", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
const directory = await mkdtemp(join(tmpdir(), "papers-r2-check-"));
const path = `papers/attachments/_checks/${randomUUID()}`;
let attempted = false;
try {
  const original = randomBytes(64);
  const source = join(directory, "source.bin"),
    target = join(directory, "target.bin");
  await writeFile(source, original, { mode: 0o600 });
  attempted = true;
  run([
    "r2",
    "object",
    "put",
    path,
    "--remote",
    "--file",
    source,
    "--content-type",
    "application/octet-stream",
  ]);
  run(["r2", "object", "get", path, "--remote", "--file", target]);
  assert.deepEqual(
    await readFile(target),
    original,
    "R2 round trip bytes differ",
  );
  console.log(
    "Both runtimes target papers; production R2 write/read bytes verified.",
  );
} finally {
  try {
    if (attempted) {
      run(["r2", "object", "delete", path, "--remote"]);
      console.log("Synthetic R2 probe removed.");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
