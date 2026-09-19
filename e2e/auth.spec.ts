import { test, expect } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASSWORD } from "./constants";
import { signInWithPassword } from "./helpers";

// Everything in this file exercises the signed-out experience, so it deliberately runs with an
// empty storage state instead of the shared owner session the rest of the suite reuses.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("authentication", () => {
  test("unauthenticated visit shows the sign-in page, not the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Only authorized suprstars allowed" })).toBeVisible();
    await expect(page.getByTestId("org-switcher")).not.toBeVisible();
    await expect(page.getByTestId("new-post")).not.toBeVisible();
  });

  test("wrong password shows an error and does not sign in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use a password instead" }).click();
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText(/invalid email or password/i);
    await expect(page.getByTestId("org-switcher")).not.toBeVisible();
  });

  test("correct login lands on Overview with the org switcher", async ({ page }) => {
    await signInWithPassword(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("org-switcher")).toBeVisible();
  });

  test("sign out from the user menu returns to sign-in", async ({ page }) => {
    await signInWithPassword(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(page.getByTestId("org-switcher")).toBeVisible();

    await page.getByTestId("user-menu-trigger").click();
    await expect(page.getByTestId("user-menu")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByRole("heading", { name: "Only authorized suprstars allowed" })).toBeVisible();
    await expect(page.getByTestId("org-switcher")).not.toBeVisible();
  });

  test("API returns 401 for /api/orgs without a session cookie", async ({ request }) => {
    const res = await request.get("/api/orgs");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/sign in required/i);
  });
});
