import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { z } from "zod";
import lockfile from "proper-lockfile";
import { setTimeout as delay } from "node:timers/promises";

const credentialsSchema = z.object({
  clientId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number(),
  scope: z.string(),
});
type Credentials = z.infer<typeof credentialsSchema>;
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
});
export const defaultScopes =
  "agents:read inboxes:read inboxes:write email:send numbers:read sms:read events:read offline_access";
export class CliAuth {
  readonly origin: string;
  readonly path: string;
  private refreshing?: Promise<string>;
  constructor(
    origin: string,
    private directory = process.env.PAPERS_CONFIG_DIR ??
      join(homedir(), ".config", "papers"),
    private fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(origin);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error("Use an HTTPS origin, or HTTP localhost for development");
    this.origin = url.origin;
    this.path = join(
      directory,
      createHash("sha256").update(this.origin).digest("hex") + ".json",
    );
  }
  private async read() {
    try {
      return credentialsSchema.parse(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("Cannot read Papers credentials; run login again.");
    }
  }
  private async save(value: Credentials) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = this.path + "." + randomBytes(8).toString("hex") + ".tmp";
    try {
      await writeFile(temp, JSON.stringify(value) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temp, this.path);
    } finally {
      await rm(temp, { force: true });
    }
  }
  private async locked<T>(
    work: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + 45000;
    let release: (() => Promise<void>) | undefined;
    while (!release) {
      signal?.throwIfAborted();
      try {
        release = await lockfile.lock(this.path, {
          realpath: false,
          stale: 60000,
          update: 10000,
          retries: 0,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
        if (Date.now() >= deadline)
          throw new Error(
            "Another Papers process is updating credentials. Try again shortly.",
          );
        await delay(100, undefined, { signal });
      }
    }
    try {
      signal?.throwIfAborted();
      return await work();
    } finally {
      await release();
    }
  }
  private async post(
    path: string,
    body: Record<string, string> | object,
    json = false,
    signal?: AbortSignal,
  ) {
    const response = await this.fetcher(this.origin + path, {
      method: "POST",
      headers: {
        Origin: this.origin,
        "Content-Type": json
          ? "application/json"
          : "application/x-www-form-urlencoded",
      },
      body: json
        ? JSON.stringify(body)
        : new URLSearchParams(body as Record<string, string>),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code =
        typeof body.error === "string" && /^[a-z_]{1,80}$/.test(body.error)
          ? body.error
          : "request_rejected";
      throw new Error(
        `OAuth ${path.split("/").at(-1)} failed (${response.status}, ${code}). Sign in again if access was revoked or expired.`,
      );
    }
    return response;
  }
  async token(signal?: AbortSignal): Promise<string> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.locked(() => this.loadToken(signal), signal);
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }
  private async loadToken(signal?: AbortSignal) {
    const current = await this.read();
    if (!current) throw new Error("Run papers login or set PAPERS_API_KEY.");
    if (current.expiresAt > Date.now() + 30000) return current.accessToken;
    if (!current.refreshToken)
      throw new Error("Your login expired. Run papers login again.");
    const response = await this.post(
      "/api/auth/oauth2/token",
      {
        grant_type: "refresh_token",
        client_id: current.clientId,
        refresh_token: current.refreshToken,
        resource: this.origin + "/v1",
      },
      false,
      signal,
    );
    const token = tokenSchema.parse(await response.json());
    await this.save({
      ...current,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? current.refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000,
      scope: token.scope ?? current.scope,
    });
    return token.access_token;
  }
  async logout(localOnly = false) {
    return this.locked(() => this.clearCredentials(localOnly));
  }
  private async clearCredentials(localOnly: boolean) {
    const current = await this.read();
    if (current && !localOnly) {
      for (const [hint, token] of [
        ["access_token", current.accessToken],
        ["refresh_token", current.refreshToken],
      ] as const) {
        if (token)
          await this.post("/api/auth/oauth2/revoke", {
            client_id: current.clientId,
            token,
            token_type_hint: hint,
          });
      }
    }
    await rm(this.path, { force: true });
  }
  async login(options: {
    scope?: string;
    signal: AbortSignal;
    openBrowser?: boolean;
    onUrl: (url: string) => void;
  }) {
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    let settle: ((code: string) => void) | undefined;
    let fail: ((error: Error) => void) | undefined;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      if (request.method !== "GET" || url.pathname !== "/callback") {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }
      if (url.searchParams.get("state") !== state) {
        response.statusCode = 400;
        response.end("Invalid login state");
        return;
      }
      if (url.searchParams.has("error")) {
        response.end(
          "Papers authorization was declined. Return to your terminal.",
        );
        fail?.(new Error("Authorization declined"));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        response.statusCode = 400;
        response.end("Missing authorization code");
        return;
      }
      response.end(
        "Papers authorization received. Return to your terminal to finish.",
      );
      settle?.(code);
    });
    const abort = () => {
      server.closeAllConnections();
      server.close();
      fail?.(new Error("Login interrupted"));
    };
    options.signal.throwIfAborted();
    options.signal.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Unable to open login callback");
      const redirectUri = `http://127.0.0.1:${address.port}/callback`;
      const registered = z.object({ client_id: z.string() }).parse(
        await (
          await this.post(
            "/api/auth/oauth2/register",
            {
              client_name: "Papers CLI",
              application_type: "native",
              redirect_uris: [redirectUri],
              token_endpoint_auth_method: "none",
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
            },
            true,
            options.signal,
          )
        ).json(),
      );
      const scope = options.scope ?? defaultScopes;
      const query = new URLSearchParams({
        client_id: registered.client_id,
        response_type: "code",
        redirect_uri: redirectUri,
        scope,
        resource: this.origin + "/v1",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        state,
        prompt: "consent",
      });
      const url = this.origin + "/api/auth/oauth2/authorize?" + query;
      const code = await new Promise<string>((resolve, reject) => {
        settle = resolve;
        fail = reject;
        if (options.signal.aborted) {
          reject(new Error("Login interrupted"));
          return;
        }
        options.onUrl(url);
        if (options.openBrowser) {
          const command =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "explorer.exe"
                : "xdg-open";
          const child = spawn(command, [url], { stdio: "ignore" });
          child.on("error", () => {});
          child.unref();
        }
      });
      const token = tokenSchema.parse(
        await (
          await this.post(
            "/api/auth/oauth2/token",
            {
              grant_type: "authorization_code",
              client_id: registered.client_id,
              code,
              code_verifier: verifier,
              redirect_uri: redirectUri,
              resource: this.origin + "/v1",
            },
            false,
            options.signal,
          )
        ).json(),
      );
      await this.locked(
        () =>
          this.save({
            clientId: registered.client_id,
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: Date.now() + token.expires_in * 1000,
            scope: token.scope ?? scope,
          }),
        options.signal,
      );
      return {
        loggedIn: true,
        origin: this.origin,
        scope: token.scope ?? scope,
      };
    } finally {
      options.signal.removeEventListener("abort", abort);
      server.closeAllConnections();
      server.close();
    }
  }
}
