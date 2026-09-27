import { pathToFileURL } from "node:url";
import { packageInfo, releaseNotes } from "./release-state.mjs";

export function tagTarget(ref) {
  for (const target of ["npm", "python"]) {
    const info = packageInfo(target);
    if (ref === `refs/tags/${info.tag}`) {
      releaseNotes(info);
      return target;
    }
  }
  throw new Error(
    `Release tag ${ref || "(missing)"} must match an SDK's current package name and version`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(`target=${tagTarget(process.env.GITHUB_REF)}`);
