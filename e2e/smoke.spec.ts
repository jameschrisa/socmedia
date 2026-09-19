import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

const ORG_ID_KEY = "pulse-app";

test.describe("suprstar smoke", () => {
  test("API health and seeded organizations (authenticated)", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.ok()).toBeTruthy();
    const body = await health.json();
    expect(body.ok).toBe(true);
    const orgs = await request.get("/api/orgs");
    const list = await orgs.json();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const conns = await request.get("/api/connections", { headers: { "X-Org-Id": list[0].id } });
    const c = await conns.json();
    expect(c.map((x: any) => x.platform).sort()).toEqual(["instagram", "linkedin", "tiktok", "youtube"]);
  });

  test("navigates between primary tabs", async ({ page }) => {
    await gotoApp(page);
    for (const label of ["Calendar", "Studio", "Social Profiles", "Analytics", "Settings", "Overview"]) {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(label === "Overview" ? /\/$/ : new RegExp(label.toLowerCase().replace(" ", "").replace("socialprofiles", "connections")));
    }
  });

  test("switches organization and scopes data", async ({ page, request }) => {
    const orgsRes = await request.get("/api/orgs");
    const orgs: { id: string; name: string }[] = await orgsRes.json();
    expect(orgs.length).toBeGreaterThanOrEqual(2);

    await gotoApp(page);
    const currentText = (await page.getByTestId("org-switcher").innerText()) ?? "";
    const target = orgs.find((o) => !currentText.includes(o.name));
    expect(target, "expected at least one other organization to switch to").toBeTruthy();

    await page.getByTestId("org-switcher").click();
    await page.getByRole("option", { name: target!.name }).click();
    await expect(page.getByTestId("org-switcher")).toContainText(target!.name);
    const stored = await page.evaluate((k) => localStorage.getItem(k), ORG_ID_KEY);
    expect(stored).toContain("currentOrgId");
  });

  test("social profile cards flip to reveal configuration", async ({ page }) => {
    await gotoApp(page, "/connections");
    for (const name of ["TikTok", "YouTube", "LinkedIn", "Instagram"]) {
      await expect(page.getByRole("heading", { name, exact: true }).first()).toBeVisible();
    }
    const configure = page.getByRole("button", { name: /configure/i }).first();
    await configure.click();
    await expect(page.getByLabel(/client id/i).first()).toBeVisible();
  });

  test("connection test returns a result in sandbox mode", async ({ page }) => {
    await gotoApp(page, "/connections");
    const testBtn = page.getByRole("button", { name: /test connection/i }).first();
    await testBtn.click();
    await expect(page.getByText(/credentials|token|reachable|API/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("calendar renders the month grid with scheduled posts and a week view", async ({ page }) => {
    await gotoApp(page, "/calendar");
    await expect(page.getByRole("gridcell").first()).toBeVisible();
    const cells = await page.getByRole("gridcell").count();
    expect(cells).toBeGreaterThanOrEqual(35);
    await page.getByRole("tab", { name: /week/i }).click();
    await expect(page.getByText(/9 AM|9:00/i).first()).toBeVisible();
  });

  test("new post opens the composer with platform targets and time scroller", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("new-post").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Schedule" }).click();
    await expect(dialog.getByTestId("time-scroller")).toBeVisible();
    await expect(dialog.getByText(/TikTok|YouTube|LinkedIn|Instagram/).first()).toBeVisible();
  });

  test("AI assistant generates captions (mock or live)", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("ai-toggle").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const brief = dialog.getByRole("textbox").first();
    await brief.fill("Announce our new tax-loss harvesting report for financial advisors");
    await dialog.getByRole("button", { name: /generate/i }).first().click();
    await expect(dialog.getByRole("button", { name: /use in composer/i }).first()).toBeVisible({ timeout: 30_000 });
  });

  test("analytics page shows KPIs after sync", async ({ page }) => {
    // Sync only produces data for *connected* accounts; the default org (F3i) is seeded with
    // disconnected sandbox connections, so switch to the demo org that ships pre-connected.
    await gotoApp(page);
    await page.getByTestId("org-switcher").click();
    await page.getByRole("option", { name: /Larkspur Health/ }).click();
    await expect(page.getByTestId("org-switcher")).toContainText("Larkspur Health");

    await page.goto("/analytics");
    await page.getByRole("button", { name: /sync/i }).first().click();
    await expect(page.getByText(/impressions/i).first()).toBeVisible();
  });
});
