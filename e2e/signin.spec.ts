import { test, expect } from "@playwright/test";
import { OWNER_EMAIL, OWNER_STORAGE_STATE, WEB_BASE_URL } from "./constants";
import { inviteUser } from "./helpers";

const runId = Date.now();

test.describe("sign-in page (signed out)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows the heading, the magic-link form, no Google button, the domains footer and a Request access link", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Only authorized suprstars allowed" })).toBeVisible();

    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);

    await expect(page.getByText(/Sign-in is limited to/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
  });

  test('"Use a password instead" reveals the password form (Email + Password)', async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use a password instead" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    // The reverse toggle is offered too, since both a link and a password are on offer.
    await expect(page.getByRole("button", { name: "Use a sign-in link instead" })).toBeVisible();
  });

  test("?auth=error&reason=expired shows the expired notice and the query string is stripped from the URL", async ({ page }) => {
    await page.goto("/?auth=error&reason=expired");
    await expect(page.getByRole("alert")).toContainText(/expired/i);
    await expect(page).toHaveURL(`${WEB_BASE_URL}/`);
    expect(new URL(page.url()).search).toBe("");
  });
});

test.describe("magic link sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("nurse@enelhealth.com signs in via a magic link, is auto-provisioned editor scoped to Enel Health, and the link is single-use", async ({ page, browser }) => {
    const email = `nurse-${runId}@enelhealth.com`;

    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();

    await expect(page.getByText("Check your email.")).toBeVisible();
    await expect(page.getByText(/Development mode: no mail provider is configured/)).toBeVisible();

    const magicLink = page.locator('a[href*="/api/auth/magic/verify"]');
    await expect(magicLink).toBeVisible();
    const href = await magicLink.getAttribute("href");
    expect(href).toBeTruthy();

    await magicLink.click();
    await expect(page).toHaveURL(`${WEB_BASE_URL}/`);
    await expect(page.getByTestId("org-switcher")).toBeVisible();

    // Verify provisioning server-side, as the owner, from an isolated context so it doesn't
    // disturb this page's freshly-issued session cookie.
    const ownerContext = await browser.newContext({ storageState: OWNER_STORAGE_STATE, baseURL: WEB_BASE_URL });
    try {
      const usersRes = await ownerContext.request.get("/api/users");
      expect(usersRes.ok()).toBeTruthy();
      const users: Array<{ email: string; role: string; orgIds: string[] | "*" }> = await usersRes.json();
      const created = users.find((u) => u.email === email);
      expect(created, `expected ${email} to have been auto-provisioned`).toBeTruthy();
      expect(created!.role).toBe("editor");

      const orgsRes = await ownerContext.request.get("/api/orgs");
      const orgs: Array<{ id: string; name: string }> = await orgsRes.json();
      const enel = orgs.find((o) => o.name === "Enel Health");
      expect(enel, "expected a seeded Enel Health org").toBeTruthy();
      expect(created!.orgIds).toEqual([enel!.id]);
    } finally {
      await ownerContext.close();
    }

    // The org switcher should reflect that this user only has Enel Health -- either by only
    // listing Enel Health in the dropdown, or, failing that, by having it selected as the
    // current org (a fresh browser has no stored "current org" preference).
    const trigger = page.getByTestId("org-switcher");
    const currentOrgLabel = (await trigger.textContent()) ?? "";
    await trigger.click();
    const optionNames = await page.getByTestId("org-switcher-menu").getByRole("option").allTextContents();
    // The open menu's full-viewport click-outside overlay sits above the trigger, so re-clicking
    // the trigger itself is blocked; click the overlay directly to close the menu instead.
    await page.mouse.click(2, 2);
    const listedOnlyEnelHealth = optionNames.length === 1 && optionNames.some((n) => n.includes("Enel Health"));
    const currentOrgIsEnelHealth = currentOrgLabel.includes("Enel Health");
    // Soft: this is a known defect (see QA-REPORT.md "Round 3"), recorded here without aborting the
    // rest of this test (sign-out + link-reuse below are independent and still worth checking).
    expect
      .soft(
        listedOnlyEnelHealth || currentOrgIsEnelHealth,
        `expected the org switcher to be scoped to Enel Health for a newly provisioned Enel-Health-only editor` +
          ` (dropdown listed: ${optionNames.join(", ")}; current org shown: "${currentOrgLabel}")`,
      )
      .toBe(true);

    // Sign out, then reuse the same link: it must now be rejected as invalid.
    await page.getByTestId("user-menu-trigger").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Only authorized suprstars allowed" })).toBeVisible();

    await page.goto(href!);
    await expect(page.getByRole("alert")).toContainText(/not valid/i);
  });
});

test.describe("disallowed domain", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("someone@gmail.com gets an inline 403 naming the allowed domains", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(`someone-${runId}@gmail.com`);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(/enelhealth\.com/i);
    await expect(alert).toContainText(/f3insights\.com/i);
  });

  test("API: a disallowed domain gets 403 reason domain; an invited user (any domain) gets 200", async ({ request }) => {
    const deniedRes = await request.post("/api/auth/magic/request", { data: { email: `someone-${runId}@gmail.com` } });
    expect(deniedRes.status()).toBe(403);
    const deniedBody = await deniedRes.json();
    expect(deniedBody.reason).toBe("domain");

    const allowedRes = await request.post("/api/auth/magic/request", { data: { email: OWNER_EMAIL } });
    expect(allowedRes.status()).toBe(200);
    const allowedBody = await allowedRes.json();
    expect(allowedBody.ok).toBe(true);
  });
});

test.describe("deactivated user", () => {
  test("a deactivated user's magic-link request is refused with reason inactive", async ({ browser, request }) => {
    const ownerContext = await browser.newContext({ storageState: OWNER_STORAGE_STATE, baseURL: WEB_BASE_URL });
    const email = `deactivate-${runId}@suprstar.test`;
    try {
      const ownerPage = await ownerContext.newPage();
      await inviteUser(ownerPage, { name: "Deactivate Me", email, role: "editor" });
      await ownerPage.close();

      const usersRes = await ownerContext.request.get("/api/users");
      const users: Array<{ id: string; email: string }> = await usersRes.json();
      const created = users.find((u) => u.email === email);
      expect(created).toBeTruthy();

      const patchRes = await ownerContext.request.patch(`/api/users/${created!.id}`, { data: { active: false } });
      expect(patchRes.ok(), await patchRes.text()).toBeTruthy();
    } finally {
      await ownerContext.close();
    }

    const res = await request.post("/api/auth/magic/request", { data: { email } });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("inactive");
  });
});
