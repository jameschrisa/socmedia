import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test.describe("multi-account publishing", () => {
  test("adding a second TikTok account lets a post queue across both", async ({ page, request }) => {
    const orgRes = await request.post("/api/orgs", {
      data: { name: `Multi Account QA ${Date.now()}`, brandColor: "#336699", timezone: "UTC" },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const org = await orgRes.json();

    await gotoApp(page);
    await page.getByTestId("org-switcher").click();
    await page.getByRole("option", { name: org.name }).click();
    await expect(page.getByTestId("org-switcher")).toContainText(org.name);

    await page.goto("/connections");
    const tiktokGroup = page.getByTestId("platform-group-tiktok");
    await expect(tiktokGroup).toContainText("1 account");
    await tiktokGroup.getByTestId("add-account-tiktok").click();

    const addDialog = page.getByRole("dialog");
    await expect(addDialog.getByRole("heading", { name: "Add TikTok account" })).toBeVisible();
    await addDialog.getByLabel("Label").fill("Founder");
    await addDialog.getByTestId("add-account-submit").click();
    await expect(addDialog).not.toBeVisible();
    await expect(tiktokGroup).toContainText("2 accounts");

    await page.getByTestId("new-post").click();
    const composer = page.getByRole("dialog");
    await expect(composer).toBeVisible();
    const uniqueTitle = `Queue test ${Date.now()}`;
    await composer.getByPlaceholder("Give this post a title").fill(uniqueTitle);

    const targetGroup = composer.getByTestId("target-group-tiktok");
    await targetGroup.getByRole("button", { name: "Select all TikTok accounts" }).click();
    await expect(targetGroup).toContainText("2/2 accounts");

    const publishMode = composer.getByTestId("publish-mode");
    await expect(publishMode).toBeVisible();
    await publishMode.getByRole("tab", { name: "Queue" }).click();
    await publishMode.getByLabel("Queue spacing minutes").fill("45");

    await composer.getByRole("button", { name: "Save draft" }).click();
    await expect(composer).not.toBeVisible();

    const postsRes = await request.get("/api/posts?includeUnscheduled=1", { headers: { "X-Org-Id": org.id } });
    expect(postsRes.ok()).toBeTruthy();
    const posts = await postsRes.json();
    const created = posts.find((p: { title: string }) => p.title === uniqueTitle);
    expect(created, `expected a post titled "${uniqueTitle}"`).toBeTruthy();
    const tiktokTargets = created.targets.filter((t: { platform: string }) => t.platform === "tiktok");
    expect(tiktokTargets).toHaveLength(2);
    expect(created.publishMode).toBe("queue");
    expect(created.queueSpacingMinutes).toBe(45);
  });
});
