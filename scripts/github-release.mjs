import { packageInfo, releaseNotes, isPublished } from "./release-state.mjs";

const target = process.argv[2];
const info = packageInfo(target);
const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
if (!repository || !sha || !process.env.GH_TOKEN)
  throw new Error("GitHub Actions release context required");
// Registries can take a few seconds to make a just-uploaded release visible.
let published = false;
for (let attempt = 0; attempt < 12; attempt++) {
  if (await isPublished(target, info)) {
    published = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
if (!published)
  throw new Error(
    `Cannot create a GitHub release before ${info.tag} is published`,
  );
const api = `https://api.github.com/repos/${repository}`;
const headers = {
  Authorization: `Bearer ${process.env.GH_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
const existing = await fetch(
  `${api}/releases/tags/${encodeURIComponent(info.tag)}`,
  { headers },
);
if (existing.ok) {
  console.log(`GitHub release already exists: ${info.tag}`);
} else {
  if (existing.status !== 404)
    throw new Error(`GitHub release lookup failed: ${existing.status}`);
  const result = await fetch(`${api}/releases`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: info.tag,
      target_commitish: sha,
      name: info.tag,
      body: releaseNotes(info),
      make_latest: "false",
    }),
  });
  if (!result.ok)
    throw new Error(
      `GitHub release creation failed: ${result.status} ${await result.text()}`,
    );
  console.log(`Created GitHub release: ${info.tag}`);
}
