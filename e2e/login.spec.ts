import { test, expect } from "@playwright/test";

// The sign-in gate is what a signed-out visitor sees, so this whole file runs signed-out.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("sign-in background video", () => {
  test("a signed-out visit renders the looping background video with a poster and an mp4 source", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Only authorized suprstars allowed" })).toBeVisible();

    const video = page.locator("video");
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAttribute("poster", "/media/login-bg.jpg");
    // React applies `muted` on <video>/<audio> as a DOM property rather than reflecting it as an
    // HTML attribute (a documented React quirk), so it's asserted as a JS property, not an attribute.
    await expect(video).toHaveJSProperty("muted", true);
    await expect(video).toHaveAttribute("loop", "");
    await expect(video).toHaveAttribute("playsinline", "");

    const source = video.locator("source");
    await expect(source).toHaveAttribute("src", "/media/login-bg.mp4");
    await expect(source).toHaveAttribute("type", "video/mp4");

    await expect(page.locator("img[src='/media/login-bg.jpg']")).toHaveCount(0);
  });

  test("prefers-reduced-motion renders the poster image instead of a video", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Only authorized suprstars allowed" })).toBeVisible();
      await expect(page.locator("video")).toHaveCount(0);
      const img = page.locator("img[src='/media/login-bg.jpg']");
      await expect(img).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test("both background media files are served as the right content type", async ({ request }) => {
    const mp4 = await request.get("/media/login-bg.mp4");
    expect(mp4.status()).toBe(200);
    expect(mp4.headers()["content-type"]).toContain("video/mp4");

    const mp4Head = await request.fetch("/media/login-bg.mp4", { method: "HEAD" });
    expect(mp4Head.status()).toBe(200);
    expect(mp4Head.headers()["content-type"]).toContain("video/mp4");

    const jpg = await request.get("/media/login-bg.jpg");
    expect(jpg.status()).toBe(200);
    expect(jpg.headers()["content-type"]).toContain("image/jpeg");
  });
});
