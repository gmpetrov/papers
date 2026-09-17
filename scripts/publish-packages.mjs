import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const target = process.argv[2];
if (target && !["npm", "python"].includes(target))
  throw new Error("Expected npm or python");
const run = (command, args) =>
  execFileSync(command, args, { stdio: "inherit" });
async function exists(url) {
  const response = await fetch(url);
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(`Registry check failed: ${response.status} ${url}`);
  return true;
}

// Explicit targets prevent accidentally publishing the CLI or internal packages.
// Registry checks let a retry recover when only one registry succeeded.
if (!target || target === "npm") {
  const { name, version } = JSON.parse(
    readFileSync("packages/sdk-typescript/package.json", "utf8"),
  );
  if (
    await exists(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
    )
  ) {
    console.log(`${name}@${version} is already published`);
  } else {
    // npm refuses token-only publishes unless the token bypasses 2FA, so an
    // account with 2FA enabled has to pass its one-time code through.
    const otp = process.env.NPM_OTP;
    run("pnpm", [
      "--filter",
      name,
      "publish",
      "--access",
      "public",
      "--no-git-checks",
      ...(otp ? ["--otp", otp] : []),
    ]);
  }
}
if (!target || target === "python") {
  const { version } = JSON.parse(
    readFileSync("sdks/python/package.json", "utf8"),
  );
  run("node", ["scripts/sync-python-version.mjs", "--check"]);
  // uv checks individual filenames, so a partially uploaded release is recoverable.
  run("uv", [
    "publish",
    "--check-url",
    "https://pypi.org/simple/",
    "--trusted-publishing",
    "automatic",
    `sdks/python/dist/papers_bot-${version}-py3-none-any.whl`,
    `sdks/python/dist/papers_bot-${version}.tar.gz`,
  ]);
}
