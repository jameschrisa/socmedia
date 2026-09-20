import { test, expect } from "@playwright/test";
import { OWNER_STORAGE_STATE, WEB_BASE_URL } from "./constants";
import { gotoApp, inviteUser, signInFreshUser, type InvitedUser } from "./helpers";

const runId = Date.now();

let editor: InvitedUser;
let viewer: InvitedUser;

test.describe("users & roles", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: OWNER_STORAGE_STATE, baseURL: WEB_BASE_URL });
    const page = await context.newPage();
    editor = await inviteUser(page, { name: "Eve Editor", email: `editor-${runId}@suprstar.test`, role: "editor" });
    viewer = await inviteUser(page, { name: "Val Viewer", email: `viewer-${runId}@suprstar.test`, role: "viewer" });
    await context.close();
  });

  test("owner invited an editor and a viewer with temporary passwords shown", async () => {
    expect(editor.password).toMatch(/^.{8,}$/);
    expect(viewer.password).toMatch(/^.{8,}$/);
    expect(editor.password).not.toBe(viewer.password);
  });

  test("invited users appear in the Users & access table with their roles", async ({ page }) => {
    await page.goto("/settings");
    const table = page.getByTestId("users-table");
    await expect(table.getByText(editor.name)).toBeVisible();
    await expect(table.getByText(viewer.name)).toBeVisible();
    const editorRow = table.locator("tr", { hasText: editor.name });
    await expect(editorRow.getByText("Editor", { exact: true })).toBeVisible();
    const viewerRow = table.locator("tr", { hasText: viewer.name });
    await expect(viewerRow.getByText("Viewer", { exact: true })).toBeVisible();
  });

  test("viewer cannot see New post and the API rejects a viewer's post creation with 403", async ({ browser }) => {
    const { context, page } = await signInFreshUser(browser, { email: viewer.email, tempPassword: viewer.password });
    try {
      await gotoApp(page);
      await expect(page.getByTestId("new-post")).not.toBeVisible();
      await expect(page.getByTestId("rail-ai")).not.toBeVisible();

      const orgsRes = await context.request.get("/api/orgs");
      expect(orgsRes.ok()).toBeTruthy();
      const orgs = await orgsRes.json();
      expect(orgs.length).toBeGreaterThan(0);

      const postRes = await context.request.post("/api/posts", {
        headers: { "X-Org-Id": orgs[0].id },
        data: { title: "Should be rejected", caption: "", hashtags: [], mediaIds: [], targets: [] },
      });
      expect(postRes.status()).toBe(403);
    } finally {
      await context.close();
    }
  });

  test("editor can save a draft post from the composer but has no Users section in Settings", async ({ browser }) => {
    const { context, page } = await signInFreshUser(browser, { email: editor.email, tempPassword: editor.password });
    try {
      await gotoApp(page);
      await expect(page.getByTestId("new-post")).toBeVisible();

      const uniqueTitle = `Editor draft ${runId}`;
      await page.getByTestId("new-post").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByPlaceholder("Give this post a title").fill(uniqueTitle);
      await dialog.getByRole("button", { name: "Save draft" }).click();
      await expect(dialog).not.toBeVisible();

      const orgsRes = await context.request.get("/api/orgs");
      const orgs = await orgsRes.json();
      const postsRes = await context.request.get("/api/posts?includeUnscheduled=1", { headers: { "X-Org-Id": orgs[0].id } });
      expect(postsRes.ok()).toBeTruthy();
      const posts = await postsRes.json();
      const created = posts.find((p: { title: string }) => p.title === uniqueTitle);
      expect(created, `expected a draft post titled "${uniqueTitle}"`).toBeTruthy();
      expect(created.status).toBe("draft");

      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      await expect(page.getByTestId("users-card")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
