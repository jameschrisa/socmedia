import fs from "node:fs";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { OWNER_STORAGE_STATE, QUICK_PHOTO_FIXTURE, WEB_BASE_URL } from "./constants";
import { gotoApp, inviteUser, signInFreshUser, switchOrg } from "./helpers";

const runId = Date.now();
const LARKSPUR = "Larkspur Health";
/** A real, tiny (1x1) transparent PNG -- see the identical constant/comment in inbound.spec.ts. */
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let orgId: string;
let ownerRequest: APIRequestContext;

async function apiOrgId(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/orgs");
  const orgs: { id: string; name: string }[] = await res.json();
  const larkspur = orgs.find((o) => o.name === LARKSPUR);
  expect(larkspur, `expected a seeded "${LARKSPUR}" org`).toBeTruthy();
  return larkspur!.id;
}

/** Creates a verified "test"-channel binding scoped to the Larkspur org, ready to drive
 * POST /api/inbound/test with, without going through the setup wizard. */
async function createVerifiedTestBinding(request: APIRequestContext, senderId: string, senderLabel: string): Promise<{ id: string }> {
  const createRes = await request.post("/api/inbound/bindings", {
    headers: { "X-Org-Id": orgId },
    data: { channel: "test", senderId, senderLabel },
  });
  expect(createRes.status(), await createRes.text()).toBe(201);
  const binding = await createRes.json();
  const verifyRes = await request.patch(`/api/inbound/bindings/${binding.id}`, { data: { status: "verified" } });
  expect(verifyRes.ok(), await verifyRes.text()).toBeTruthy();
  return binding;
}

/** Reads the big number out of a `stat-tile` card matched by its label. */
async function statTileValue(page: import("@playwright/test").Page, label: string): Promise<number> {
  const text = await page.locator('[data-testid="stat-tile"]', { hasText: label }).innerText();
  const match = text.match(/(\d+)/);
  expect(match, `expected a number in the "${label}" tile: ${text}`).toBeTruthy();
  return Number(match![1]);
}

/** Pulls the count out of the Overview page's remote-drafts-notice text ("N remote draft(s) are waiting..."),
 * or 0 if the notice isn't showing at all. Only meaningful once the page's initial fetch has settled --
 * callers needing a reliable baseline should use `needsCaptionDraftCount` (the API) instead, and reserve
 * this for asserting what's actually rendered after a `expect(...).toBeVisible()`/`expect.poll(...)` wait. */
async function draftsNoticeCount(page: import("@playwright/test").Page): Promise<number> {
  const notice = page.getByTestId("remote-drafts-notice");
  if ((await notice.count()) === 0) return 0;
  const text = await notice.innerText();
  const match = text.match(/(\d+)/);
  expect(match, `expected a number in the drafts notice: ${text}`).toBeTruthy();
  return Number(match![1]);
}

/** Ground truth for how many remote (phone/chat) drafts are waiting on a caption right now, computed
 * straight from the API rather than the page (a fresh page load races the Overview page's own fetch,
 * which is exactly the source of flakiness this sidesteps for "before" baselines). Mirrors
 * `needsCaption`/`remoteSourceOf` in client/src/features/remote/remoteUtils.ts. */
async function needsCaptionDraftCount(request: APIRequestContext): Promise<number> {
  const res = await request.get("/api/posts?includeUnscheduled=1", { headers: { "X-Org-Id": orgId } });
  const posts: { status: string; notes: string; labels: string[] }[] = await res.json();
  return posts.filter(
    (p) => p.status === "draft" && (p.labels.includes("quick") || p.labels.includes("inbound")) && p.notes.startsWith("Needs a caption"),
  ).length;
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: OWNER_STORAGE_STATE, baseURL: WEB_BASE_URL });
  ownerRequest = context.request;
  orgId = await apiOrgId(ownerRequest);
});

test.describe("Remote Posting", () => {
  test("the nav tab exists for the owner and is hidden for a viewer, who sees the read-only note at /remote", async ({ page, browser }) => {
    await gotoApp(page);
    const navLink = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Remote Posting", exact: true });
    await expect(navLink).toBeVisible();
    await navLink.click();
    await expect(page).toHaveURL(/\/remote$/);
    await expect(page.getByRole("heading", { name: "Remote Posting" })).toBeVisible();
    await expect(page.getByTestId("remote-tabs")).toBeVisible();

    const viewer = await inviteUser(page, { name: "Remote Viewer", email: `remote-viewer-${runId}@suprstar.test`, role: "viewer" });
    const { context, page: viewerPage } = await signInFreshUser(browser, { email: viewer.email, tempPassword: viewer.password });
    try {
      await gotoApp(viewerPage);
      await expect(viewerPage.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Remote Posting" })).toHaveCount(0);

      await viewerPage.goto("/remote");
      await expect(viewerPage.getByRole("heading", { name: "Remote Posting" })).toBeVisible();
      await expect(viewerPage.getByTestId("remote-read-only")).toBeVisible();
      await expect(viewerPage.getByTestId("remote-tabs")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("hash routing selects each tab and the segmented bar reflects it", async ({ page }) => {
    await gotoApp(page);
    await page.goto("/remote");
    const tabs = page.getByTestId("remote-tabs");
    await expect(tabs.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");

    // Clicking a tab pushes the matching hash.
    await tabs.getByRole("tab", { name: "Phone links" }).click();
    await expect(page).toHaveURL(/\/remote#phone$/);
    await expect(tabs.getByRole("tab", { name: "Phone links" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Phone links" }).first()).toBeVisible();

    // Direct navigation to each hash lands on the matching tab.
    await page.goto("/remote#chat");
    await expect(tabs.getByRole("tab", { name: "Chat channels" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("inbound-section")).toBeVisible();

    await page.goto("/remote#posts");
    await expect(tabs.getByRole("tab", { name: "Remote posts" })).toHaveAttribute("aria-selected", "true");

    await page.goto("/remote#overview");
    await expect(tabs.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  test("Overview: a remote draft needing a caption can be captioned and published from the queue, KPI tiles update, and the Overview page notice reflects it", async ({ page }) => {
    await createVerifiedTestBinding(ownerRequest, `remote-overview-${runId}`, "Remote Overview QA");

    // A leftover needs-caption draft from an earlier round's phone flow may already exist, so every
    // check below asserts a *delta* off this API-computed baseline, not an absolute count.
    const beforeCount = await needsCaptionDraftCount(ownerRequest);

    // Create a remote (chat) draft needing a caption: an image with no text.
    const testRes = await ownerRequest.post("/api/inbound/test", {
      data: { senderId: `remote-overview-${runId}`, imageUrl: TINY_PNG_DATA_URL },
    });
    expect(testRes.ok(), await testRes.text()).toBeTruthy();
    const testBody = await testRes.json();
    expect(testBody.status).toBe("draft");
    const postId: string = testBody.postId;
    expect(postId).toBeTruthy();
    const afterCreateCount = beforeCount + 1;
    await expect.poll(() => needsCaptionDraftCount(ownerRequest)).toBe(afterCreateCount);

    // The Overview page's notice now includes this draft.
    await gotoApp(page);
    await switchOrg(page, LARKSPUR);
    const notice = page.getByTestId("remote-drafts-notice");
    await expect(notice).toBeVisible();
    await expect.poll(() => draftsNoticeCount(page)).toBe(afterCreateCount);
    await expect(notice).toHaveAttribute("href", "/remote#overview");

    await notice.click();
    await expect(page).toHaveURL(/\/remote#overview$/);
    await expect(page.getByTestId("remote-tabs").getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");

    await expect.poll(() => statTileValue(page, "Needs a caption")).toBe(afterCreateCount);

    const row = page.getByTestId("needs-caption-row").filter({ hasText: "Chat" }).first();
    await expect(row).toBeVisible();

    const caption = `Published from the Remote Overview queue ${runId}`;
    const saveBtn = row.getByRole("button", { name: "Save caption" });
    const publishBtn = row.getByRole("button", { name: "Publish now" });
    await expect(saveBtn).toBeDisabled();
    await row.getByLabel("Caption").fill(caption);
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(page.getByText("Caption saved")).toBeVisible();
    await expect(saveBtn).toBeDisabled();

    await publishBtn.click();
    await expect(page.getByText("Post published")).toBeVisible();
    await expect(row).toHaveCount(0);

    await expect.poll(() => statTileValue(page, "Needs a caption")).toBe(beforeCount);

    const postRes = await ownerRequest.get(`/api/posts/${postId}`, { headers: { "X-Org-Id": orgId } });
    expect(postRes.ok()).toBeTruthy();
    const post = await postRes.json();
    expect(post.status).toBe("published");
    expect(post.caption).toBe(caption);
    await expect.poll(() => needsCaptionDraftCount(ownerRequest)).toBe(beforeCount);

    // The Overview page's notice count drops back down (the pre-existing leftover draft, if any, keeps it non-zero).
    await page.goto("/");
    if (beforeCount === 0) {
      await expect(page.getByTestId("remote-drafts-notice")).toHaveCount(0);
    } else {
      await expect.poll(() => draftsNoticeCount(page)).toBe(beforeCount);
    }
  });

  test("Remote posts: lists posts from both sources with per-account links, the source filter narrows, and Delete with confirm removes a row", async ({ page }) => {
    const phoneCaption = `Remote posts QA phone ${runId}`;
    const chatCaption = `Remote posts QA chat ${runId}`;

    const tokenRes = await ownerRequest.post("/api/quick/tokens", {
      headers: { "X-Org-Id": orgId },
      data: { label: `QA remote posts ${runId}`, connectionIds: [], publishMode: "all" },
    });
    expect(tokenRes.status(), await tokenRes.text()).toBe(201);
    const token = (await tokenRes.json()).token as string;
    const imageBuffer = fs.readFileSync(QUICK_PHOTO_FIXTURE);
    const phonePostRes = await ownerRequest.post(`/api/quick/${token}`, {
      multipart: { image: { name: "photo.jpg", mimeType: "image/jpeg", buffer: imageBuffer }, caption: phoneCaption },
    });
    expect(phonePostRes.status(), await phonePostRes.text()).toBe(201);
    const phonePostId: string = (await phonePostRes.json()).post.id;

    await createVerifiedTestBinding(ownerRequest, `remote-posts-chat-${runId}`, "Remote Posts QA");
    const chatRes = await ownerRequest.post("/api/inbound/test", {
      data: { senderId: `remote-posts-chat-${runId}`, text: chatCaption, imageUrl: TINY_PNG_DATA_URL },
    });
    expect(chatRes.ok(), await chatRes.text()).toBeTruthy();
    const chatPostId: string = (await chatRes.json()).postId;
    expect(chatPostId).toBeTruthy();

    await gotoApp(page);
    await switchOrg(page, LARKSPUR);
    await page.goto("/remote#posts");

    const phoneRow = page.getByTestId("remote-post-row").filter({ hasText: phoneCaption });
    const chatRow = page.getByTestId("remote-post-row").filter({ hasText: chatCaption });
    await expect(phoneRow).toBeVisible();
    await expect(chatRow).toBeVisible();
    await expect(phoneRow.getByText("Phone", { exact: true })).toBeVisible();
    await expect(chatRow.getByText("Chat", { exact: true })).toBeVisible();
    // Per-account links: at least one live link icon on each row (sandbox publishing to Larkspur's
    // pre-connected accounts always produces a fake external URL).
    await expect(phoneRow.locator('a[target="_blank"]').first()).toBeVisible();
    await expect(chatRow.locator('a[target="_blank"]').first()).toBeVisible();

    await page.getByRole("tab", { name: "Phone", exact: true }).click();
    await expect(phoneRow).toBeVisible();
    await expect(chatRow).toHaveCount(0);

    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await expect(chatRow).toBeVisible();
    await expect(phoneRow).toHaveCount(0);

    await page.getByRole("tab", { name: "All sources" }).click();
    await expect(phoneRow).toBeVisible();
    await expect(chatRow).toBeVisible();

    await phoneRow.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("dialog").filter({ hasText: "Delete this post?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Post deleted")).toBeVisible();
    await expect(phoneRow).toHaveCount(0);
    await expect(chatRow).toBeVisible();

    const deletedRes = await ownerRequest.get(`/api/posts/${phonePostId}`, { headers: { "X-Org-Id": orgId } });
    expect(deletedRes.status()).toBe(404);
    const stillThereRes = await ownerRequest.get(`/api/posts/${chatPostId}`, { headers: { "X-Org-Id": orgId } });
    expect(stillThereRes.ok()).toBeTruthy();
  });

  test("Chat channels as an editor: setup is read-only but the message monitor and bindings should still be visible", async ({ page, browser }) => {
    await createVerifiedTestBinding(ownerRequest, `remote-editor-${runId}`, "Editor Visibility QA");
    const msgRes = await ownerRequest.post("/api/inbound/test", {
      data: { senderId: `remote-editor-${runId}`, text: `Editor visibility check ${runId}`, imageUrl: TINY_PNG_DATA_URL },
    });
    expect(msgRes.ok(), await msgRes.text()).toBeTruthy();

    const editor = await inviteUser(page, { name: "Chat Editor", email: `chat-editor-${runId}@suprstar.test`, role: "editor" });
    const { context, page: editorPage } = await signInFreshUser(browser, { email: editor.email, tempPassword: editor.password });
    try {
      await gotoApp(editorPage);
      await switchOrg(editorPage, LARKSPUR);
      await editorPage.goto("/remote#chat");

      // The part of this that *is* correctly gated: no way to configure a channel.
      await expect(editorPage.getByTestId("chat-channels-read-only")).toBeVisible();
      await expect(editorPage.getByTestId("setup-channel")).toHaveCount(0);

      // Defect (see QA-REPORT.md "Round 6"): GET /api/inbound/messages and GET /api/inbound/bindings are
      // requireRole("editor") server-side (server/src/routes/inbound.ts), and InboundMonitor/
      // InboundBindingsTable are built entirely on those two editor-permitted endpoints -- but
      // ChatChannelsTab (client/src/features/remote/RemotePostingPage.tsx) swaps the *entire* tab for
      // chat-channels-read-only whenever `can.manageSettings` is false, hiding the monitor and bindings
      // table an editor is otherwise allowed to see, instead of only gating the setup/config controls.
      await expect
        .soft(
          editorPage.getByTestId("inbound-message-row").filter({ hasText: "Editor Visibility QA" }),
          "an editor should still be able to see the inbound message monitor even though channel setup is admin-only",
        )
        .toBeVisible({ timeout: 10_000 });
      await expect
        .soft(
          editorPage.getByTestId("inbound-binding-row").filter({ hasText: "Editor Visibility QA" }),
          "an editor should still be able to see the linked-senders (bindings) table even though channel setup is admin-only",
        )
        .toBeVisible({ timeout: 10_000 });
    } finally {
      await context.close();
    }
  });

  test("the right-rail Inbound popover's Open Remote Posting link lands on /remote#chat", async ({ page }) => {
    await gotoApp(page, "/studio");
    await page.getByTestId("rail-inbound").click();
    const panel = page.getByRole("dialog", { name: "Inbound" });
    await expect(panel).toBeVisible();
    const link = panel.getByRole("link", { name: "Open Remote Posting" });
    await expect(link).toHaveAttribute("href", "/remote#chat");
    await link.click();
    await expect(page).toHaveURL(/\/remote#chat$/);
    await expect(page.getByTestId("remote-tabs").getByRole("tab", { name: "Chat channels" })).toHaveAttribute("aria-selected", "true");
  });
});
