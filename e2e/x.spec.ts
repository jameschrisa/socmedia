import { test, expect } from "@playwright/test";
import { PLATFORMS } from "@socmedia/shared";
import { gotoApp, switchOrg } from "./helpers";

const runId = Date.now();

test.describe("X platform", () => {
  test("Social Profiles shows an X card per org, among all 5 platform groups", async ({ page }) => {
    await gotoApp(page);
    await page.goto("/connections");

    for (const platform of PLATFORMS) {
      await expect(page.getByTestId(`platform-group-${platform}`)).toBeVisible();
    }
    expect(PLATFORMS.length).toBe(5);
    await expect(page.getByTestId("platform-group-x")).toContainText("X");
    await expect(page.getByTestId("connection-x")).toBeVisible();
  });

  test("Connect on X in sandbox mode marks it connected with a handle, and the authorize URL uses PKCE (S256)", async ({ page, request }) => {
    const orgRes = await request.post("/api/orgs", {
      data: { name: `X Connect QA ${runId}`, brandColor: "#1D9BF0", timezone: "UTC" },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const org = await orgRes.json();

    await gotoApp(page);
    await switchOrg(page, org.name);
    await page.goto("/connections");

    const xCard = page.getByTestId("connection-x");
    await expect(xCard).toContainText("Sandbox");
    await xCard.getByRole("button", { name: "Connect", exact: true }).click();

    // The "no account connected" placeholder text is present even while disconnected, so assert on
    // the connected-account block itself (only rendered once status is "connected") instead.
    await expect(xCard.getByText("@sandbox_x")).toBeVisible();
    await expect(xCard.getByText("Sandbox Account")).toBeVisible();

    // Verify the underlying authorize URL directly (the UI doesn't surface it once sandbox-connected).
    const connsRes = await request.get("/api/connections", { headers: { "X-Org-Id": org.id } });
    const conns = await connsRes.json();
    const xConn = conns.find((c: { platform: string }) => c.platform === "x");
    expect(xConn.status).toBe("connected");

    const connectRes = await request.post(`/api/connections/${xConn.id}/connect`, { headers: { "X-Org-Id": org.id } });
    expect(connectRes.ok(), await connectRes.text()).toBeTruthy();
    const connectBody = await connectRes.json();
    expect(connectBody.authorizeUrl).toContain("code_challenge_method=S256");
  });

  test("composer: an X-only 281-char caption trips the 280 limit and blocks Publish now; trimming to 280 clears it", async ({ page }) => {
    await gotoApp(page);
    await page.goto("/studio");
    await page.getByTestId("new-post").click();

    const composer = page.getByRole("dialog");
    await expect(composer).toBeVisible();
    await composer.getByLabel("Include X").check();

    const caption = composer.getByPlaceholder("Write your caption…");
    const publishNow = composer.getByRole("button", { name: "Publish now" });

    await caption.fill("x".repeat(281));
    await expect(composer.getByText("X captions are limited to 280 characters (currently 281).")).toBeVisible();
    await expect(publishNow).toBeDisabled();

    await caption.fill("x".repeat(280));
    await expect(composer.getByText(/X captions are limited to 280 characters/)).toHaveCount(0);
    await expect(publishNow).toBeEnabled();

    await expect(composer.getByTestId("preview-x")).toBeVisible();
  });

  test("publish now on X succeeds and the job's URL is on x.com (API)", async ({ request }) => {
    const orgRes = await request.post("/api/orgs", {
      data: { name: `X Publish QA ${runId}`, brandColor: "#1D9BF0", timezone: "UTC" },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const org = await orgRes.json();
    const headers = { "X-Org-Id": org.id };

    const connsRes = await request.get("/api/connections", { headers });
    const conns = await connsRes.json();
    const xConn = conns.find((c: { platform: string }) => c.platform === "x");
    expect(xConn).toBeTruthy();

    const connectRes = await request.post(`/api/connections/${xConn.id}/connect`, { headers });
    expect(connectRes.ok(), await connectRes.text()).toBeTruthy();

    const postRes = await request.post("/api/posts", {
      headers,
      data: {
        title: `X publish QA ${runId}`,
        caption: "Hello from the suprstar e2e suite",
        targets: [{ platform: "x", connectionId: xConn.id, format: "square", mediaIds: [], caption: null, title: null, hashtags: null }],
      },
    });
    expect(postRes.ok(), await postRes.text()).toBeTruthy();
    const post = await postRes.json();

    const publishRes = await request.post(`/api/posts/${post.id}/publish`, { headers });
    expect(publishRes.ok(), await publishRes.text()).toBeTruthy();
    const { jobs } = await publishRes.json();
    const xJob = jobs.find((j: { platform: string }) => j.platform === "x");
    expect(xJob?.status).toBe("succeeded");
    expect(xJob?.externalUrl).toContain("x.com");
  });

  test("the calendar platform filter includes X", async ({ page }) => {
    await gotoApp(page);
    await page.goto("/calendar");
    await page.getByTestId("platform-filter").click();

    const menu = page.getByTestId("platform-filter-menu");
    const xOption = menu.getByRole("option", { name: "Toggle x filter" });
    await expect(xOption).toBeVisible();

    await xOption.click();
    await expect(page.getByTestId("platform-filter")).toContainText(`${PLATFORMS.length - 1} of ${PLATFORMS.length} platforms`);

    await xOption.click();
    await expect(page.getByTestId("platform-filter")).toContainText("All platforms");
  });

  test("Analytics renders an X series in the Engagement-by-platform chart after syncing a connected X account", async ({ page, request }) => {
    const orgRes = await request.post("/api/orgs", {
      data: { name: `X Analytics QA ${runId}`, brandColor: "#1D9BF0", timezone: "UTC" },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const org = await orgRes.json();

    await gotoApp(page);
    await switchOrg(page, org.name);

    await page.goto("/connections");
    await page.getByTestId("connection-x").getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByTestId("connection-x").getByText("@sandbox_x")).toBeVisible();

    await page.goto("/analytics");
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByTestId("analytics-page")).toBeVisible();

    const engagementCard = page.locator(".card", { has: page.getByRole("heading", { name: "Engagement by platform" }) });
    await expect(engagementCard.getByText("X", { exact: true })).toBeVisible({ timeout: 15_000 });
  });
});
