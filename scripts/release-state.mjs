import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function packageInfo(target) {
  const directory = { npm: "packages/sdk-typescript", python: "sdks/python" }[
    target
  ];
  if (!directory) throw new Error("Expected npm or python");
  const { name, version } = JSON.parse(
    readFileSync(`${directory}/package.json`, "utf8"),
  );
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Only stable x.y.z releases are supported");
  return { directory, name, version, tag: `${name}@${version}` };
}

export async function isPublished(
  target,
  info = packageInfo(target),
  fetcher = fetch,
) {
  const url =
    target === "npm"
      ? `https://registry.npmjs.org/${encodeURIComponent(info.name)}/${info.version}`
      : `https://pypi.org/pypi/${info.name}/${info.version}/json`;
  const response = await fetcher(url);
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(`Registry lookup failed: ${response.status}`);
  const data = await response.json();
  if (target === "npm")
    return data.name === info.name && data.version === info.version;
  const files = new Set(data.urls?.map((file) => file.filename));
  return (
    files.has(`papers_bot-${info.version}-py3-none-any.whl`) &&
    files.has(`papers_bot-${info.version}.tar.gz`)
  );
}

export function releaseNotes(info) {
  const changelog = readFileSync(`${info.directory}/CHANGELOG.md`, "utf8");
  const heading = `## ${info.version}`;
  const lines = changelog.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`Missing changelog entry for ${info.tag}`);
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("## "),
  );
  const notes = lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
  if (!notes) throw new Error(`Empty changelog entry for ${info.tag}`);
  return notes;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const target = process.argv[2];
  const info = packageInfo(target);
  releaseNotes(info);
  const publish = !(await isPublished(target, info));
  console.log(
    `${info.tag}: ${publish ? "upload required" : "already published"}`,
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
}
