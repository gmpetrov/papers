#!/usr/bin/env node
import { CliAuth, defaultScopes } from "./auth";
import { once } from "node:events";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { createMcpServer } from "@agentinfra/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
import { positiveInteger, watchEvents, waitForOperation } from "./polling";
import { Papers, PapersError } from "@papers.bot/sdk";
async function readAttachments(paths: string[] | undefined) {
  if (!paths?.length) return undefined;
  if (paths.length > 10) throw new Error("At most 10 attachments");
  const sizes = await Promise.all(paths.map((path) => stat(path)));
  if (
    sizes.some((s) => !s.isFile()) ||
    sizes.reduce((n, s) => n + s.size, 0) > 5 * 1024 * 1024
  )
    throw new Error("Attachments exceed 5 MiB or are not files");
  const types: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".vcf": "text/vcard",
    ".ics": "text/calendar",
  };
  return Promise.all(
    paths.map(async (path) => ({
      filename: basename(path),
      contentType:
        types[extname(path).toLowerCase()] ?? "application/octet-stream",
      content: (await readFile(path)).toString("base64"),
    })),
  );
}
const cli = new Command()
  .name("papers")
  .description("Email and phone infrastructure for agents")
  .version("0.1.0")
  .option(
    "--base-url <url>",
    "API origin",
    process.env.PAPERS_BASE_URL ?? "https://dev.chaindesk.ai",
  )
  .option("--json", "Machine-readable output", true);
function client(signal?: AbortSignal) {
  const auth = new CliAuth(cli.opts().baseUrl);
  const apiKey = process.env.PAPERS_API_KEY;
  return new Papers({
    apiKey: apiKey ?? "oauth",
    signal,
    baseUrl: auth.origin,
    ...(!apiKey
      ? {
          fetch: async (input: string | URL | Request, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            headers.set(
              "Authorization",
              `Bearer ${await auth.token(init?.signal ?? undefined)}`,
            );
            return fetch(input, { ...init, headers });
          },
        }
      : {}),
  });
}
const print = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
};
cli.command("whoami").action(async () => print(await client().me()));
cli
  .command("capabilities")
  .action(async () => print(await client().capabilities()));
const inboxes = cli.command("inboxes");
inboxes
  .command("archive <id>")
  .description(
    "Stop new email sends and inbound storage; retain the address and message history",
  )
  .action(async (id) => print(await client().inboxes.archive(id)));
inboxes
  .command("reactivate <id>")
  .description("Resume an archived inbox if workspace capacity allows")
  .action(async (id) => print(await client().inboxes.reactivate(id)));
inboxes
  .command("list")
  .option("--cursor <cursor>", "Continue from a previous page")
  .option("--limit <count>", "Page size (1–100)", positiveInteger, 100)
  .action(async (o) => print(await client().inboxes.list(o.cursor, o.limit)));
inboxes
  .command("create")
  .requiredOption("--name <name>")
  .requiredOption("--address <localPart>")
  .option("--agent <id>", "Legacy agent restriction (optional)")
  .requiredOption("--idempotency-key <key>")
  .action(async (o) =>
    print(
      await client().inboxes.create(
        { name: o.name, localPart: o.address, agentId: o.agent },
        { idempotencyKey: o.idempotencyKey },
      ),
    ),
  );
const messages = cli.command("messages");
messages
  .command("list")
  .requiredOption("--inbox <id>")
  .action(async (o) => print(await client().messages.list(o.inbox)));
messages
  .command("get <id>")
  .action(async (id) => print(await client().messages.get(id)));
cli
  .command("attachments")
  .command("download <id>")
  .description("Download an attachment to a new local file")
  .requiredOption("--output <path>", "Destination file (must not exist)")
  .option(
    "--max-bytes <bytes>",
    "Download limit, up to 26214400",
    (value) => {
      if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) > 26214400
      )
        throw new Error(
          "--max-bytes must be an integer between 0 and 26214400",
        );
      return Number(value);
    },
    26214400,
  )
  .action(async (id, options) => {
    const bytes = await client().attachments.download(id, {
      maxBytes: options.maxBytes,
    });
    const output = resolve(options.output);
    await writeFile(output, bytes, { flag: "wx", mode: 0o600 });
    print({ attachmentId: id, path: output, bytes: bytes.byteLength });
  });
messages
  .command("send")
  .requiredOption("--inbox <id>")
  .requiredOption("--to <email>")
  .requiredOption("--subject <subject>")
  .requiredOption("--text <text>")
  .option(
    "--attach <paths...>",
    "Attach local files (MMS: 1 MB total; email: 5 MiB)",
  )
  .requiredOption("--idempotency-key <key>")
  .action(async (o) =>
    print(
      await client().messages.send(
        o.inbox,
        {
          to: [o.to],
          subject: o.subject,
          text: o.text,
          attachments: await readAttachments(o.attach),
        },
        { idempotencyKey: o.idempotencyKey },
      ),
    ),
  );
messages
  .command("reply <id>")
  .requiredOption("--text <text>")
  .option(
    "--attach <paths...>",
    "Attach local files (MMS: 1 MB total; email: 5 MiB)",
  )
  .requiredOption("--idempotency-key <key>")
  .action(async (id, o) =>
    print(
      await client().messages.reply(
        id,
        { text: o.text, attachments: await readAttachments(o.attach) },
        { idempotencyKey: o.idempotencyKey },
      ),
    ),
  );
messages
  .command("mark <id>")
  .requiredOption("--unread <boolean>", "true or false")
  .action(async (id, o) => {
    if (!["true", "false"].includes(o.unread))
      throw new Error("--unread must be true or false");
    print(await client().messages.setUnread(id, o.unread === "true"));
  });
async function interruptible(run: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await run(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
cli
  .command("login")
  .description("Authorize this CLI through browser workspace consent")
  .option("--scope <scopes>", "Space-separated permissions", defaultScopes)
  .option("--no-browser", "Print the login URL without opening a browser")
  .action(async (options) =>
    interruptible(async (signal) => {
      const auth = new CliAuth(cli.opts().baseUrl);
      print(
        await auth.login({
          scope: options.scope,
          openBrowser: options.browser,
          signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
          onUrl: (url) =>
            process.stderr.write(
              `Open this URL to connect Papers (expires in 5 minutes):\n${url}\n`,
            ),
        }),
      );
    }),
  );
cli
  .command("logout")
  .description("Revoke and remove locally stored OAuth credentials")
  .option("--local-only", "Remove credentials without remote revocation")
  .action(async (options) => {
    await new CliAuth(cli.opts().baseUrl).logout(options.localOnly);
    print({
      loggedOut: true,
      ...(process.env.PAPERS_API_KEY
        ? { note: "PAPERS_API_KEY is still set in your environment." }
        : {}),
    });
  });
cli
  .command("approvals")
  .command("list")
  .option("--cursor <cursor>", "Continue from a previous page")
  .option("--limit <count>", "Page size (1–100)", positiveInteger, 25)
  .action(async (o) => print(await client().approvals.list(o.cursor, o.limit)));
const operations = cli.command("operations");
operations
  .command("get <id>")
  .action(async (id) => print(await client().operations.get(id)));
operations
  .command("wait <id>")
  .option("--interval <seconds>", "Polling interval", positiveInteger, 2)
  .option("--timeout <seconds>", "Maximum wait", positiveInteger, 120)
  .action(async (id, o) =>
    interruptible(async (signal) => {
      const sdk = client(
        AbortSignal.any([signal, AbortSignal.timeout(o.timeout * 1000)]),
      );
      const operation = await waitForOperation(() => sdk.operations.get(id), {
        intervalMs: o.interval * 1000,
        timeoutMs: o.timeout * 1000,
        signal,
      });
      print(operation);
      if (operation.status === "failed") process.exitCode = 1;
    }),
  );
const numbers = cli.command("numbers");
numbers
  .command("buy")
  .requiredOption("--number <phone>")
  .requiredOption("--country <code>")
  .requiredOption(
    "--monthly-cost <amount>",
    "Monthly price from search results",
  )
  .requiredOption(
    "--upfront-cost <amount>",
    "Upfront price from search results",
  )
  .requiredOption("--currency <code>")
  .requiredOption("--idempotency-key <key>")
  .action(async (o) =>
    print(
      await client().numbers.provision(
        {
          phoneNumber: o.number,
          country: o.country,
          monthlyCost: o.monthlyCost,
          upfrontCost: o.upfrontCost,
          currency: o.currency,
        },
        { idempotencyKey: o.idempotencyKey },
      ),
    ),
  );
numbers
  .command("release <id>")
  .requiredOption("--idempotency-key <key>")
  .requiredOption("--confirm", "Confirm permanent number release")
  .action(async (id, o) =>
    print(
      await client().numbers.release(id, { idempotencyKey: o.idempotencyKey }),
    ),
  );

numbers
  .command("list")
  .option("--cursor <cursor>", "Continue from a previous page")
  .option("--limit <count>", "Page size (1–100)", positiveInteger, 100)
  .action(async (o) => print(await client().numbers.list(o.cursor, o.limit)));
numbers
  .command("search")
  .option("--country <code>", "Country ISO code", "US")
  .action(async (o) => print(await client().numbers.search(o.country)));
numbers
  .command("get <id>")
  .action(async (id) => print(await client().numbers.get(id)));
const sms = cli.command("sms");
sms
  .command("send")
  .requiredOption("--number <id>")
  .requiredOption("--to <phone>")
  .requiredOption("--text <text>")
  .option(
    "--attach <paths...>",
    "Attach local files (MMS: 1 MB total; email: 5 MiB)",
  )
  .requiredOption("--idempotency-key <key>")
  .action(async (o) =>
    print(
      await client().sms.send(
        o.number,
        {
          to: o.to,
          text: o.text,
          attachments: await readAttachments(o.attach),
        },
        { idempotencyKey: o.idempotencyKey },
      ),
    ),
  );
sms
  .command("list")
  .requiredOption("--number <id>")
  .option("--cursor <cursor>")
  .action(async (o) => print(await client().sms.list(o.number, o.cursor)));
sms.command("get <id>").action(async (id) => print(await client().sms.get(id)));
const events = cli.command("events");
events
  .command("list")
  .option("--cursor <cursor>")
  .action(async (o) => print(await client().events.list(o.cursor)));
events
  .command("watch")
  .description("Stream events as newline-delimited JSON; save cursor to resume")
  .option("--cursor <cursor>")
  .option("--interval <seconds>", "Polling interval", positiveInteger, 2)
  .action(async (o) =>
    interruptible(async (signal) => {
      const sdk = client(signal);
      for await (const item of watchEvents(
        (cursor) => sdk.events.list(cursor),
        { cursor: o.cursor, intervalMs: o.interval * 1000, signal },
      )) {
        if (!process.stdout.write(JSON.stringify(item) + "\n"))
          await once(process.stdout, "drain", { signal });
      }
    }),
  );
cli
  .command("mcp")
  .description("Run the local stdio MCP adapter")
  .action(async () => {
    const sdk = client();
    await createMcpServer(
      (path, method, body, key) =>
        sdk.request(
          path,
          method,
          body,
          key ? { idempotencyKey: key } : undefined,
        ),
      (id, maxBytes) => sdk.attachments.download(id, { maxBytes }),
    ).connect(new StdioServerTransport());
  });
cli.parseAsync().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      error: {
        code: error instanceof PapersError ? error.code : "cli_error",
        message: error.message,
        ...(error instanceof PapersError && error.details
          ? { details: error.details }
          : {}),
      },
    }) + "\n",
  );
  process.exitCode = 1;
});
