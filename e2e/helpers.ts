import type { Browser, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { UserRole } from "@socmedia/shared";
import { WEB_BASE_URL } from "./constants";

/** Navigates to the app and waits for the authenticated shell (org switcher) to render. */
export async function gotoApp(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId("org-switcher")).toBeVisible();
}

/** Switches the active org via the org switcher dropdown to the one matching `orgName`. */
export async function switchOrg(page: Page, orgName: string): Promise<void> {
  await page.getByTestId("org-switcher").click();
  await page.getByRole("option", { name: orgName }).click();
  await expect(page.getByTestId("org-switcher")).toContainText(orgName);
}

export interface InvitedUser {
  name: string;
  email: string;
  role: UserRole;
  password: string;
}

/**
 * Drives the "Invite user" flow in Settings -> Users & access as the currently signed-in admin/owner,
 * leaving org access at its default ("All organizations"). Returns the generated temporary password
 * shown in the confirmation step.
 */
export async function inviteUser(page: Page, { name, email, role }: { name: string; email: string; role: UserRole }): Promise<InvitedUser> {
  await page.goto("/settings");
  await expect(page.getByTestId("users-card")).toBeVisible();
  await page.getByTestId("invite-user-button").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Invite user" })).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Role").selectOption(role);

  const passwordInput = dialog.getByLabel("Temporary password");
  const password = await passwordInput.inputValue();
  expect(password.length).toBeGreaterThanOrEqual(8);

  await dialog.getByRole("button", { name: "Invite" }).click();
  await expect(dialog.getByRole("heading", { name: "Temporary password" })).toBeVisible();
  const revealed = await dialog.getByLabel("Temporary password").inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).not.toBeVisible();

  return { name, email, role, password: revealed || password };
}

/**
 * Opens a brand-new browser context (no shared storage state), signs in as `email`/`tempPassword`,
 * clears the forced password-change step via POST /auth/password so the session behaves like a
 * normal signed-in user, and returns the ready-to-use context + page.
 */
export async function signInFreshUser(
  browser: Browser,
  { email, tempPassword, newPassword = "correct-horse-battery-staple" }: { email: string; tempPassword: string; newPassword?: string },
): Promise<{ context: Awaited<ReturnType<Browser["newContext"]>>; page: Page }> {
  const context = await browser.newContext({ baseURL: WEB_BASE_URL });
  const loginRes = await context.request.post("/api/auth/login", { data: { email, password: tempPassword } });
  expect(loginRes.ok(), `login failed for ${email}: ${await loginRes.text()}`).toBeTruthy();

  const changeRes = await context.request.post("/api/auth/password", {
    data: { currentPassword: tempPassword, newPassword },
  });
  expect(changeRes.ok(), `password change failed for ${email}: ${await changeRes.text()}`).toBeTruthy();

  const page = await context.newPage();
  return { context, page };
}
