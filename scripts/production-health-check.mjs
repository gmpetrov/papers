import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const origin = process.env.NEXT_PUBLIC_APP_URL || "https://www.papers.bot";
let failure;
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    const response = await fetch(new URL("/api/health", origin), {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    assert.equal(response.status, 200, "Health endpoint must return HTTP 200");
    const health = await response.json();
    assert.equal(health.status, "ok");
    assert.equal(health.database, "connected");
    console.log("Production health passed: database connected");
    process.exit(0);
  } catch (error) {
    failure = error;
    console.warn(`Health check attempt ${attempt} failed`);
    if (attempt < 6) await setTimeout(5000);
  }
}
throw failure;
