/** Local emulator only. Copy retained files before changing/restarting bucket bindings. */
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";

type StoredObject = { size: number; arrayBuffer(): Promise<ArrayBuffer> };
type Bucket = {
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<{
    objects: { key: string; size: number }[];
    truncated: boolean;
    cursor?: string;
  }>;
  get(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string } },
  ): Promise<unknown>;
};
const directory = await mkdtemp(join(tmpdir(), "papers-local-bucket-copy-"));
const configPath = join(directory, "wrangler.json");
const digest = (bytes: ArrayBuffer) =>
  createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
let platform:
  | Awaited<
      ReturnType<typeof getPlatformProxy<{ SOURCE: Bucket; TARGET: Bucket }>>
    >
  | undefined;
try {
  await writeFile(
    configPath,
    JSON.stringify({
      name: "papers-local-bucket-copy",
      compatibility_date: "2026-09-16",
      r2_buckets: [
        { binding: "SOURCE", bucket_name: "papers-attachments" },
        { binding: "TARGET", bucket_name: "papers" },
      ],
    }),
    { mode: 0o600 },
  );
  platform = await getPlatformProxy<{ SOURCE: Bucket; TARGET: Bucket }>({
    configPath,
    persist: {
      path: fileURLToPath(new URL("../.wrangler/shared", import.meta.url)),
    },
  });
  let cursor: string | undefined;
  let copied = 0,
    verified = 0,
    bytes = 0;
  do {
    const page = await platform.env.SOURCE.list({
      prefix: "attachments/",
      cursor,
    });
    for (const entry of page.objects) {
      if (entry.size > 25 * 1024 * 1024)
        throw new Error(
          "Source exceeds supported attachment size; migration stopped",
        );
      const source = await platform.env.SOURCE.get(entry.key);
      if (!source)
        throw new Error("Source disappeared; stop writers and retry");
      const sourceBytes = await source.arrayBuffer();
      const hash = digest(sourceBytes);
      let target = await platform.env.TARGET.get(entry.key);
      if (!target) {
        await platform.env.TARGET.put(entry.key, sourceBytes, {
          httpMetadata: { contentType: "application/octet-stream" },
        });
        copied++;
        target = await platform.env.TARGET.get(entry.key);
      }
      if (
        !target ||
        target.size !== source.size ||
        digest(await target.arrayBuffer()) !== hash
      )
        throw new Error(
          "Destination verification failed; source retained and existing destination not overwritten",
        );
      verified++;
      bytes += source.size;
    }
    cursor = page.truncated ? page.cursor : undefined;
    if (page.truncated && !cursor) throw new Error("Missing pagination cursor");
  } while (cursor);
  console.log(
    JSON.stringify({
      storage: "local-only",
      copied,
      verified,
      bytes,
      sourceRetained: true,
    }),
  );
} finally {
  await platform?.dispose();
  await rm(directory, { recursive: true, force: true });
}
