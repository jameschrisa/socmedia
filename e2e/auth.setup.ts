import { expect, test as setup } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASSWORD, OWNER_STORAGE_STATE } from "./constants";

/**
 * Signs in as the bootstrap owner (created on server boot from ADMIN_EMAIL/ADMIN_PASSWORD)
 * through the real login form, then saves the resulting session cookie + localStorage so the
 * rest of the suite can reuse it instead of logging in for every test.
 */
setup("authenticate as owner", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Only authorized suprstars allowed" })).toBeVisible();
  // The sign-in page defaults to the magic-link form; reveal the password form to sign in the
  // bootstrap owner the same way the rest of the suite always has.
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("org-switcher")).toBeVisible();
  await page.context().storageState({ path: OWNER_STORAGE_STATE });
});
