import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let accepts = 0,
    selections = 0;
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body,
      status = 200;
    if (path.endsWith("/get-session"))
      body = {
        session: {
          id: "fixture-session",
          userId: "fixture-user",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        user: {
          id: "fixture-user",
          email: "invited@example.test",
          name: "Invited",
          emailVerified: true,
        },
      };
    else if (path.endsWith("/get-invitation"))
      body = {
        id: "fixture",
        organizationId: "fixture-org",
        organizationName: "Research workspace",
        role: "member",
        email: "invited@example.test",
        inviterEmail: "owner@example.test",
      };
    else if (path.endsWith("/accept-invitation")) {
      accepts++;
      body = { invitation: { organizationId: "fixture-org" } };
    } else if (path.endsWith("/set-active")) {
      selections++;
      status = 503;
      body = { message: "Workspace selection temporarily unavailable" };
    } else if (path.endsWith("/reject-invitation"))
      body = { invitation: { status: "rejected" } };
    else throw new Error("Unexpected auth request: " + path);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("http://localhost:3000/invite/fixture");
  await expect(
    page.getByText("Research workspace", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "You've joined the workspace." }),
  ).toBeVisible();
  await expect(page.locator("main [role=alert]")).toContainText(
    "Workspace selection temporarily unavailable",
  );
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect.poll(() => selections).toBe(2);
  expect(accepts).toBe(1);
  await page.goto("http://localhost:3000/invite/fixture");
  await page
    .getByRole("button", { name: "Decline invitation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Invitation declined." }),
  ).toBeVisible();
  console.log(
    "Invitation review, decline, and workspace retry UI passed (mocked auth responses).",
  );
} finally {
  await browser.close();
}
