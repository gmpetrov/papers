import { request, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const fixture = Object.fromEntries(
  (await readFile(".env.e2e", "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("=")),
);
const origin = "https://dev.chaindesk.ai";
const api = await request.newContext({
  baseURL: origin,
  extraHTTPHeaders: { Origin: origin },
});
let id: string | undefined;
try {
  expect(
    (
      await api.post("/api/auth/sign-in/email", {
        data: { email: fixture.TEST_EMAIL, password: fixture.TEST_PASSWORD },
      })
    ).status(),
  ).toBe(200);
  const organizations = await (
    await api.get("/api/auth/organization/list")
  ).json();
  expect(organizations.length).toBeGreaterThan(0);
  expect(
    (
      await api.post("/api/auth/organization/set-active", {
        data: { organizationId: organizations[0].id },
      })
    ).status(),
  ).toBe(200);
  const created = await api.post("/v1/webhook-endpoints", {
    data: {
      name: "Temporary runtime verification",
      url: "https://hooks.example.com/events",
      eventTypes: ["inbox.runtime_test"],
    },
  });
  expect(created.status()).toBe(201);
  const endpoint = await created.json();
  id = endpoint.id;
  expect(endpoint.enabled).toBe(false);
  expect(typeof endpoint.signingSecret).toBe("string");
  const listing = await (await api.get("/v1/webhook-endpoints")).json();
  const saved = listing.data.find((row: { id: string }) => row.id === id);
  expect(saved).toBeTruthy();
  expect(Object.keys(saved)).not.toContain("signingSecret");
  expect(Object.keys(saved)).not.toContain("secretCiphertext");
  const rotated = await api.post(`/v1/webhook-endpoints/${id}/rotate-secret`);
  expect(rotated.status()).toBe(200);
  const rotation = await rotated.json();
  expect(rotation.secretVersion).toBe(2);
  expect(rotation.signingSecret === endpoint.signingSecret).toBe(false);
  expect(
    (await api.post(`/v1/webhook-endpoints/${id}/rotate-secret`)).status(),
  ).toBe(409);
  expect(
    (
      await api.patch(`/v1/webhook-endpoints/${id}`, {
        data: { enabled: true },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.patch(`/v1/webhook-endpoints/${id}`, {
        data: { enabled: false },
      })
    ).status(),
  ).toBe(200);
  expect((await api.delete(`/v1/webhook-endpoints/${id}`)).status()).toBe(200);
  id = undefined;
  console.log(
    "Customer webhook configuration, one-time secrets, rotation overlap, activation, deactivation, and deletion passed through the development tunnel. No callbacks sent.",
  );
} finally {
  if (id) await api.delete(`/v1/webhook-endpoints/${id}`);
  await api.post("/api/auth/sign-out");
  await api.dispose();
}
