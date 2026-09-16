import { expect, it, vi } from "vitest";
import { handleMcp, toolScopes } from "../../../apps/mcp/src/index";

const rpc = (method: string, params?: unknown) =>
  new Request("https://papers.test/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
it("advertises and returns exact binary attachment content over MCP", async () => {
  const download = vi.fn().mockResolvedValue(new Uint8Array([0, 128, 255]));
  const call = vi.fn();
  const listing = await (
    await handleMcp(rpc("tools/list"), call, download)
  ).json();
  const tool = listing.result.tools.find(
    (item: { name: string }) => item.name === "download_attachment",
  );
  expect(tool.annotations.readOnlyHint).toBe(true);
  expect(toolScopes.download_attachment).toBe("inboxes:read");
  const response = await handleMcp(
    rpc("tools/call", {
      name: "download_attachment",
      arguments: { attachmentId: "file/id" },
    }),
    call,
    download,
  );
  const result = (await response.json()).result;
  expect(result.isError).not.toBe(true);
  expect(result.content[1]).toEqual({
    type: "resource",
    resource: {
      uri: "papers://attachments/file%2Fid",
      mimeType: "application/octet-stream",
      blob: "AID/",
    },
  });
  expect(download).toHaveBeenCalledWith("file/id", 1024 * 1024);
  expect(call).not.toHaveBeenCalled();
});

it("validates limits before download and returns operational failures as tool errors", async () => {
  const download = vi
    .fn()
    .mockRejectedValue(new Error("Attachment storage is pending"));
  for (const maxBytes of [-1, 1.5, 26214401]) {
    const result = await (
      await handleMcp(
        rpc("tools/call", {
          name: "download_attachment",
          arguments: { attachmentId: "file", maxBytes },
        }),
        vi.fn(),
        download,
      )
    ).json();
    expect(result.result?.isError || result.error).toBeTruthy();
  }
  expect(download).not.toHaveBeenCalled();
  const result = await (
    await handleMcp(
      rpc("tools/call", {
        name: "download_attachment",
        arguments: { attachmentId: "file", maxBytes: 0 },
      }),
      vi.fn(),
      download,
    )
  ).json();
  expect(result.result.isError).toBe(true);
  expect(result.result.content).toEqual([
    { type: "text", text: "Attachment storage is pending" },
  ]);
  expect(download).toHaveBeenCalledTimes(1);
  expect(download).toHaveBeenCalledWith("file", 0);
});
