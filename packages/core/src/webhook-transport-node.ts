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
