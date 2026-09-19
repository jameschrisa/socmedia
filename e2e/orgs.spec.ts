import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test.describe("demo organizations", () => {
  test("Enel Health is seeded on a fresh database and shows its handle everywhere", async ({ page, request }) => {
    const orgsRes = await request.get("/api/orgs");
    const orgs: { id: string; name: string; slug: string }[] = await orgsRes.json();
    const enel = orgs.find((o) => o.slug === "enel-health");
    expect(enel, "expected a pre-seeded Enel Health organization").toBeTruthy();

    const conns = await request.get("/api/connections", { headers: { "X-Org-Id": enel!.id } });
    const connections = await conns.json();
    expect(connections.length).toBeGreaterThan(0);
    expect(connections.every((c: { handle: string }) => c.handle === "@enelhealth")).toBe(true);

    await gotoApp(page);
    await page.getByTestId("org-switcher").click();
    const option = page.getByRole("option", { name: /Enel Health/ });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.getByTestId("org-switcher")).toContainText("Enel Health");
    // Enel Health ships with a bundled logo, so the switcher trigger renders the image variant, not initials.
    await expect(page.getByTestId("org-switcher").getByTestId("org-logo")).toBeVisible();

    await expect(page.getByText("@enelhealth").first()).toBeVisible();
  });

  test("a new demo organization can be seeded from the larkspur profile with identity overrides", async ({ page, request }) => {
    const res = await request.post("/api/orgs/demo", {
      data: { profile: "larkspur", name: "Aster Clinic", slug: "aster-clinic", handle: "@asterclinic" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const org = await res.json();
    expect(org.name).toBe("Aster Clinic");
    expect(org.slug).toBe("aster-clinic");

    const conns = await request.get("/api/connections", { headers: { "X-Org-Id": org.id } });
    const connections = await conns.json();
    expect(connections.length).toBeGreaterThan(0);
    expect(connections.every((c: { handle: string }) => c.handle === "@asterclinic")).toBe(true);

    await gotoApp(page);
    await page.getByTestId("org-switcher").click();
    const option = page.getByRole("option", { name: /Aster Clinic/ });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.getByTestId("org-switcher")).toContainText("Aster Clinic");

    await expect(page.getByText("@asterclinic").first()).toBeVisible();
  });
});
