import { test, expect } from "@playwright/test";
import { OWNER_STORAGE_STATE, WEB_BASE_URL } from "./constants";
import { inviteUser, signInFreshUser, signInWithPassword } from "./helpers";

const runId = Date.now();
const PAT_EMAIL = `pat-${runId}@example.org`;
let patTempPassword: string | undefined;

test.describe.configure({ mode: "serial" });

test.describe("request access", () => {
  test("filling the request-access form shows a confirmation, and submitting again is rejected as a duplicate", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: WEB_BASE_URL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await page.goto("/request-access");
      await page.getByLabel("Name").fill("Pat Lee");
      await page.getByLabel("Work email").fill(PAT_EMAIL);
      await page.getByLabel("Organization").fill("Acme Org");
      await page.getByLabel("Why do you need access?").fill("Need to post on behalf of a client");
      await page.getByRole("button", { name: "Request access" }).click();
      await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();
      await expect(page.getByText(PAT_EMAIL)).toBeVisible();

      // A fresh visit to the form (not the confirmation state) submitting the same email again.
      await page.goto("/request-access");
      await page.getByLabel("Name").fill("Pat Lee");
      await page.getByLabel("Work email").fill(PAT_EMAIL);
      await page.getByRole("button", { name: "Request access" }).click();
      await expect(page.getByRole("alert")).toContainText(/pending request|account/i);
    } finally {
      await context.close();
    }
  });

  test("owner sees the pending badge and row in Settings -> Access requests", async ({ page }) => {
    await page.goto("/settings");
    const card = page.getByTestId("access-requests-card");
    await expect(card).toBeVisible();
    await expect(card.getByText("1 pending")).toBeVisible();
    await expect(card.getByTestId("access-requests-table").locator("tr", { hasText: "Pat Lee" })).toBeVisible();
  });

  test("approving with role editor and all organizations shows a temporary password", async ({ page }) => {
    await page.goto("/settings");
    const card = page.getByTestId("access-requests-card");
    const row = card.getByTestId("access-requests-table").locator("tr", { hasText: "Pat Lee" });
    await row.getByRole("button", { name: "Approve" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Approve Pat Lee" })).toBeVisible();
    await dialog.getByLabel("Role").selectOption("editor");
    // "All organizations" is the default org-access mode; leave it selected.
    await dialog.getByRole("button", { name: "Approve" }).click();

    await expect(dialog.getByRole("heading", { name: "Access granted" })).toBeVisible();
    const tempPassword = await dialog.getByLabel("Temporary password").inputValue();
    expect(tempPassword.length).toBeGreaterThanOrEqual(8);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(card.getByText("1 pending")).toHaveCount(0);

    patTempPassword = tempPassword;
  });

  test("the newly approved user signs in with the temporary password, is forced to change it, and lands on Overview", async ({ browser }) => {
    expect(patTempPassword, "expected the previous test to have captured Pat's temporary password").toBeTruthy();
    const tempPassword = patTempPassword!;

    // Explicit blank storage state: `browser.newContext()` otherwise inherits this project's
    // default (the owner's signed-in session), which would land on the owner's dashboard instead
    // of the sign-in page.
    const context = await browser.newContext({ baseURL: WEB_BASE_URL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await signInWithPassword(page, PAT_EMAIL, tempPassword);
      await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
      await page.getByLabel("Current password").fill(tempPassword);
      await page.getByLabel("New password").fill("correct-horse-battery-staple");
      await page.getByRole("button", { name: "Update password" }).click();
      await expect(page.getByTestId("org-switcher")).toBeVisible();
      await expect(page).toHaveURL(`${WEB_BASE_URL}/`);
    } finally {
      await context.close();
    }
  });

  test("declining a second request moves it out of Pending and into Declined", async ({ page, request }) => {
    const email = `sam-${runId}@example.org`;
    const createRes = await request.post("/api/auth/access-requests", { data: { name: "Sam Decline", email } });
    expect(createRes.status()).toBe(201);

    await page.goto("/settings");
    const card = page.getByTestId("access-requests-card");
    await expect(card.getByText("1 pending")).toBeVisible();
    const row = card.getByTestId("access-requests-table").locator("tr", { hasText: "Sam Decline" });
    await row.getByRole("button", { name: "Decline" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Decline access request?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Decline" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(card.getByTestId("access-requests-table").locator("tr", { hasText: "Sam Decline" })).toHaveCount(0);
    await card.getByRole("tab", { name: "Declined" }).click();
    await expect(card.getByTestId("access-requests-table").locator("tr", { hasText: "Sam Decline" })).toBeVisible();
  });
});

test.describe("sign-in policy", () => {
  test("owner adds domain example.org scoped to Larkspur Health as viewer, saves, and it persists", async ({ page, request }) => {
    await page.goto("/settings");
    const card = page.getByTestId("sign-in-policy-card");
    await expect(card).toBeVisible();

    await card.getByRole("textbox", { name: "Add domain" }).fill("example.org");
    await card.getByRole("button", { name: "Add domain" }).click();

    const row = card.getByTestId("domain-row-example.org");
    await expect(row).toBeVisible();
    await row.getByLabel("Role for example.org").selectOption("viewer");
    await row.getByRole("button", { name: "All organizations" }).click(); // turn off "all orgs"
    await row.getByRole("button", { name: "Larkspur Health" }).click(); // scope to just Larkspur

    await card.getByTestId("save-access-policy").click();
    await expect(card.getByText("Unsaved changes")).toHaveCount(0);

    await page.reload();
    const reloadedRow = page.getByTestId("domain-row-example.org");
    await expect(reloadedRow).toBeVisible();
    await expect(reloadedRow.getByLabel("Role for example.org")).toHaveValue("viewer");
    await expect(reloadedRow.getByRole("button", { name: "Larkspur Health" })).toHaveClass(/chip-active/);

    const policyRes = await request.get("/api/settings/access-policy");
    expect(policyRes.ok()).toBeTruthy();
    const policy = await policyRes.json();
    const domain = policy.domains.find((d: { domain: string }) => d.domain === "example.org");
    expect(domain).toBeTruthy();
    expect(domain.role).toBe("viewer");
    expect(domain.orgSlugs).toEqual(["larkspur-health"]);
  });

  test("a magic link for viewer@example.org now succeeds and provisions a viewer scoped only to Larkspur Health", async ({ browser }) => {
    const email = `viewer-${runId}@example.org`;
    const anon = await browser.newContext({ baseURL: WEB_BASE_URL, storageState: { cookies: [], origins: [] } });
    let link: string;
    try {
      const res = await anon.request.post("/api/auth/magic/request", { data: { email } });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.link).toBeTruthy();
      link = body.link;
      const verifyRes = await anon.request.get(link); // consumes the token and provisions the user
      expect(verifyRes.ok()).toBeTruthy();
    } finally {
      await anon.close();
    }

    const ownerContext = await browser.newContext({ storageState: OWNER_STORAGE_STATE, baseURL: WEB_BASE_URL });
    try {
      const usersRes = await ownerContext.request.get("/api/users");
      const users: Array<{ email: string; role: string; orgIds: string[] | "*" }> = await usersRes.json();
      const created = users.find((u) => u.email === email);
      expect(created, `expected ${email} to have been provisioned`).toBeTruthy();
      expect(created!.role).toBe("viewer");

      const orgsRes = await ownerContext.request.get("/api/orgs");
      const orgs: Array<{ id: string; name: string }> = await orgsRes.json();
      const larkspur = orgs.find((o) => o.name === "Larkspur Health");
      expect(larkspur).toBeTruthy();
      expect(created!.orgIds).toEqual([larkspur!.id]);
    } finally {
      await ownerContext.close();
    }
  });

  test("removing the domain and saving takes it out of the policy", async ({ page, request }) => {
    await page.goto("/settings");
    const card = page.getByTestId("sign-in-policy-card");
    const row = card.getByTestId("domain-row-example.org");
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Remove example.org" }).click();
    await card.getByTestId("save-access-policy").click();
    await expect(row).toHaveCount(0);

    const policyRes = await request.get("/api/settings/access-policy");
    const policy = await policyRes.json();
    expect(policy.domains.some((d: { domain: string }) => d.domain === "example.org")).toBe(false);
  });

  test('an invalid domain "not a domain" is rejected inline and never added', async ({ page }) => {
    await page.goto("/settings");
    const card = page.getByTestId("sign-in-policy-card");
    await card.getByRole("textbox", { name: "Add domain" }).fill("not a domain");
    await card.getByRole("button", { name: "Add domain" }).click();
    await expect(card.getByText("Enter a domain like example.com")).toBeVisible();
    // Only the two shipped defaults (enelhealth.com, f3insights.com) remain.
    await expect(card.getByTestId(/^domain-row-/)).toHaveCount(2);
  });

  test('the "Invited users may sign in..." checkbox toggles and persists', async ({ page, request }) => {
    await page.goto("/settings");
    const card = page.getByTestId("sign-in-policy-card");
    const checkbox = card.getByRole("checkbox", { name: /Invited users may sign in/ });
    await expect(checkbox).toBeChecked();

    await checkbox.uncheck();
    await card.getByTestId("save-access-policy").click();
    await page.reload();
    await expect(page.getByTestId("sign-in-policy-card").getByRole("checkbox", { name: /Invited users may sign in/ })).not.toBeChecked();
    let policyRes = await request.get("/api/settings/access-policy");
    expect((await policyRes.json()).allowInvitedUsersAnyDomain).toBe(false);

    // Restore the shipped default so this doesn't leak into other tests.
    await page.getByTestId("sign-in-policy-card").getByRole("checkbox", { name: /Invited users may sign in/ }).check();
    await page.getByTestId("sign-in-policy-card").getByTestId("save-access-policy").click();
    await page.reload();
    await expect(page.getByTestId("sign-in-policy-card").getByRole("checkbox", { name: /Invited users may sign in/ })).toBeChecked();
    policyRes = await request.get("/api/settings/access-policy");
    expect((await policyRes.json()).allowInvitedUsersAnyDomain).toBe(true);
  });
});

test.describe("API guards", () => {
  test("a viewer gets 403 on GET /api/users/access-requests and PUT /api/settings/access-policy", async ({ browser }) => {
    const ownerContext = await browser.newContext({ storageState: OWNER_STORAGE_STATE, baseURL: WEB_BASE_URL });
    const ownerPage = await ownerContext.newPage();
    const viewer = await inviteUser(ownerPage, { name: "Vera Viewer", email: `vera-${runId}@suprstar.test`, role: "viewer" });
    await ownerContext.close();

    const { context } = await signInFreshUser(browser, { email: viewer.email, tempPassword: viewer.password });
    try {
      const listRes = await context.request.get("/api/users/access-requests");
      expect(listRes.status()).toBe(403);

      const putRes = await context.request.put("/api/settings/access-policy", {
        data: { domains: [], allowInvitedUsersAnyDomain: true },
      });
      expect(putRes.status()).toBe(403);
    } finally {
      await context.close();
    }
  });

  test("PUT /api/settings/access-policy with role owner is rejected 400", async ({ request }) => {
    const res = await request.put("/api/settings/access-policy", {
      data: { domains: [{ domain: "example.com", role: "owner", orgSlugs: "*" }], allowInvitedUsersAnyDomain: true },
    });
    expect(res.status()).toBe(400);
  });
});
