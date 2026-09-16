import { it, expect } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliAuth } from "../src/auth";

async function child() {
  const process = fork(
    new URL("./fixtures/auth-process.ts", import.meta.url),
    [],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    process.once("message", () => resolve());
    process.once("error", reject);
    process.once("exit", (code) =>
      reject(new Error(`Child exited before ready: ${code}`)),
    );
  });
  return process;
}
function run(
  child: ChildProcess,
  origin: string,
  directory: string,
  action: "token" | "logout",
) {
  return new Promise<{ result?: string; error?: string }>((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`Child exited before result: ${code}`)),
    );
    child.send({ origin, directory, action });
  });
}
const credentials = {
  clientId: "test",
  accessToken: "expired",
  refreshToken: "refresh-one",
  expiresAt: 0,
  scope: "inboxes:read offline_access",
};

it.each(["token", "logout"] as const)(
  "serializes refresh with a second process running %s",
  async (secondAction) => {
    const directory = await mkdtemp(join(tmpdir(), "papers-concurrent-"));
    const requests: URLSearchParams[] = [];
    let started!: () => void;
    const refreshing = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const releaseRefresh = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const form = new URLSearchParams(body);
      requests.push(form);
      if (request.url?.endsWith("/token")) {
        started();
        await releaseRefresh;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            token_type: "Bearer",
            access_token: "rotated",
            refresh_token: "refresh-two",
            expires_in: 900,
          }),
        );
      } else response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    const origin = `http://127.0.0.1:${address.port}`;
    const auth = new CliAuth(origin, directory);
    const children: ChildProcess[] = [];
    try {
      await writeFile(auth.path, JSON.stringify(credentials), { mode: 0o600 });
      children.push(...(await Promise.all([child(), child()])));
      const first = run(children[0]!, origin, directory, "token");
      await refreshing;
      const second = run(children[1]!, origin, directory, secondAction);
      // The first process holds the lock while the second starts its command.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(requests).toHaveLength(1);
      finish();
      expect(await first).toEqual({ result: "rotated" });
      const result = await second;
      expect(result.error).toBeUndefined();
      expect(requests.filter((form) => form.has("grant_type"))).toHaveLength(1);
      if (secondAction === "token") {
        expect(result.result).toBe("rotated");
        expect(JSON.parse(await readFile(auth.path, "utf8")).refreshToken).toBe(
          "refresh-two",
        );
      } else {
        expect(
          requests
            .filter((form) => form.has("token"))
            .map((form) => form.get("token")),
        ).toEqual(["rotated", "refresh-two"]);
        await expect(readFile(auth.path)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    } finally {
      finish();
      for (const process of children) process.kill();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("cancels lock waiting and recovers an abandoned stale lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "papers-lock-"));
  const auth = new CliAuth("https://example.test", directory);
  try {
    await writeFile(
      auth.path,
      JSON.stringify({ ...credentials, expiresAt: Date.now() + 900000 }),
    );
    await mkdir(auth.path + ".lock");
    await expect(auth.token(AbortSignal.timeout(100))).rejects.toThrow();
    const stale = new Date(Date.now() - 120000);
    await utimes(auth.path + ".lock", stale, stale);
    expect(await auth.token()).toBe("expired");
    await expect(readFile(auth.path + ".lock")).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
