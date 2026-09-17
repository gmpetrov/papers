import { readFile, writeFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("sdks/python/package.json", "utf8"));
const path = "sdks/python/pyproject.toml";
const source = await readFile(path, "utf8");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error("Python releases currently require a stable x.y.z version");
}
const updated = source.replace(
  /^version = "[^"]+"$/m,
  `version = "${manifest.version}"`,
);
if (process.argv.includes("--check")) {
  if (updated !== source)
    throw new Error("Run pnpm version-packages to synchronize Python metadata");
} else {
  await writeFile(path, updated);
}
