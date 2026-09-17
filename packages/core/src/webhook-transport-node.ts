// Node-only adapter. Never import this file into the Cloudflare Worker bundle.
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { webhookEndpointInput } from "@agentinfra/contracts";
import type { WebhookTransport } from "./webhook-delivery";

export function isPublicWebhookAddress(address: string): boolean {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}

// Runs inside socket connection setup; Node connects to the exact validated IP.
// No preliminary DNS check followed by a second, potentially rebound lookup.
export const publicWebhookLookup: LookupFunction = (
  hostname,
  options,
  callback,
) => {
  void lookup(hostname, { all: true }).then(
    (addresses) => {
      if (
        !addresses.length ||
        addresses.some((item) => !isPublicWebhookAddress(item.address))
      ) {
        callback(new Error("Webhook destination is not public"), "", 4);
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    },
    () => callback(new Error("Webhook DNS lookup failed"), "", 4),
  );
};

export const nodeWebhookTransport: WebhookTransport = async (input) => {
  const url = webhookEndpointInput.shape.url.parse(input.url);
  input.signal.throwIfAborted();
  return new Promise<number>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        agent: false,
        lookup: publicWebhookLookup,
        signal: input.signal,
        maxHeaderSize: 16 * 1024,
        headers: {
          ...input.headers,
          "content-length": Buffer.byteLength(input.body),
        },
      },
      (response) => {
        // No redirect following and no response body buffering.
        const status = response.statusCode;
        response.destroy();
        if (status) resolve(status);
        else reject(new Error("Missing webhook response status"));
      },
    );
    req.on("error", () => reject(new Error("Webhook request failed")));
    req.end(input.body);
  });
};

/** Download provider media using the same DNS-pinned public-only connection policy. */
export async function nodeMediaTransport(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  const destination = webhookEndpointInput.shape.url.parse(url);
  const { Readable } = await import("node:stream");
  return new Promise((resolve, reject) => {
    const req = request(
      destination,
      {
        method: "GET",
        agent: false,
        lookup: publicWebhookLookup,
        signal,
        maxHeaderSize: 16 * 1024,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          reject(new Error("Media download failed"));
          return;
        }
        const headers = new Headers();
        if (response.headers["content-length"])
          headers.set("content-length", response.headers["content-length"]);
        resolve(
          new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
            status: 200,
            headers,
          }),
        );
      },
    );
    req.on("error", () => reject(new Error("Media download failed")));
    req.end();
  });
}
