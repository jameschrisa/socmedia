import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";
import { OVERLONG_VIDEO_FIXTURE, VIDEO_FIXTURE } from "./constants";

test.describe("video assets", () => {
  let orgId: string;

  test.beforeEach(async ({ page, request }) => {
    const orgRes = await request.post("/api/orgs", {
      data: { name: `Video QA ${Date.now()}`, brandColor: "#993366", timezone: "UTC" },
    });
    const org = await orgRes.json();
    orgId = org.id;

    await gotoApp(page);
    await page.getByTestId("org-switcher").click();
    await page.getByRole("option", { name: org.name }).click();
    await expect(page.getByTestId("org-switcher")).toContainText(org.name);
    await page.goto("/studio");
  });

  test("shows the upload size hint and refuses a video over 5:00 client-side", async ({ page }) => {
    await expect(page.getByText("Videos up to 5:00")).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(OVERLONG_VIDEO_FIXTURE);
    await expect(page.getByText(/videos must be 5 minutes or shorter/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("too-long-302s.mp4")).toHaveCount(0);
  });

  test("uploads a video, shows its duration, and trims a vertical clip via the scissors editor", async ({ page, request }) => {
    await page.locator('input[type="file"]').setInputFiles(VIDEO_FIXTURE);
    await expect(page.getByText(/uploaded clip-6s\.mp4/i)).toBeVisible({ timeout: 20_000 });

    const card = page.getByTestId("media-card").filter({ hasText: "clip-6s.mp4" });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/0:0?6/);

    const mediaBefore = await (await request.get("/api/media", { headers: { "X-Org-Id": orgId } })).json();
    const original = mediaBefore.find((m: { filename: string }) => m.filename === "clip-6s.mp4");
    expect(original).toBeTruthy();

    await card.getByRole("button", { name: "Edit clip-6s.mp4" }).click();
    const editor = page.getByRole("dialog");
    await expect(editor.getByRole("heading", { name: "Edit clip-6s.mp4" })).toBeVisible();

    // The editor re-clamps the trim range once the <video> element's *real* metadata loads
    // (it may differ slightly from the server-probed duration used for the initial render).
    // Wait for that to settle before touching the trim inputs, or a late clamp can clobber them.
    await editor.locator("video").evaluate(
      (el: HTMLVideoElement) =>
        el.readyState >= 1 ? Promise.resolve() : new Promise<void>((resolve) => el.addEventListener("loadedmetadata", () => resolve(), { once: true })),
    );

    const startInput = editor.getByLabel("Start time");
    await startInput.fill("1");
    await startInput.blur();
    const endInput = editor.getByLabel("End time");
    await endInput.fill("4");
    await endInput.blur();
    await expect(editor.getByTestId("selection-length")).toContainText(/0:0?3/);

    await editor.getByRole("button", { name: "Vertical 9:16" }).click();

    await editor.getByTestId("video-editor-submit").click();
    await expect(page.getByText(/clip saved to library/i)).toBeVisible({ timeout: 60_000 });
    await expect(editor).not.toBeVisible();

    await expect.poll(async () => {
      const media = await (await request.get("/api/media", { headers: { "X-Org-Id": orgId } })).json();
      return media.some((m: { sourceAssetId?: string | null }) => m.sourceAssetId === original.id);
    }, { timeout: 15_000 }).toBe(true);

    const mediaAfter = await (await request.get("/api/media", { headers: { "X-Org-Id": orgId } })).json();
    const newClip = mediaAfter.find((m: { sourceAssetId?: string | null }) => m.sourceAssetId === original.id);
    expect(newClip).toBeTruthy();
    expect(newClip.width).toBe(1080);
    expect(newClip.height).toBe(1920);
    expect(newClip.tags).toContain("clip");
    expect(newClip.durationSeconds).toBeGreaterThan(2.5);
    expect(newClip.durationSeconds).toBeLessThan(3.5);

    const newCard = page.locator(`[data-testid="media-card"][data-asset-id="${newClip.id}"]`);
    await expect(newCard).toBeVisible();
    await expect(newCard).toContainText(/0:0?3/);
  });
});
