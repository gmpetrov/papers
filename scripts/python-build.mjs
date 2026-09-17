import { rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Old wheels must never be included in a subsequent release.
rmSync("dist", { recursive: true, force: true });
execFileSync("uv", ["build", "--no-sources"], { stdio: "inherit" });
