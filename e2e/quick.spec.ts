import fs from "node:fs";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { OWNER_STORAGE_STATE, QUICK_PHOTO_FIXTURE, WEB_BASE_URL } from "./constants";
import { gotoApp, switchOrg } from "./helpers";

const runId = Date.now();
const LARKSPUR = "Larkspur Health";

let orgId: string;
let ownerRequest: APIRequestContext;
let createdToken: { id: string; token: string; url: string };
let edgeToken: { id: string; token: string };

async function apiOrgId(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/orgs");
  const orgs: { id: string; name: string }[] = await res.json();
  const larkspur = orgs.find((o) => o.name === LARKSPUR);
  expect(larkspur, `expected a seeded "${LARKSPUR}" org`).toBeTruthy();
  return larkspur!.id;
}

test.describe.configure({ mode: "serial" });

test.describe("quick post from a phone", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: OWNER_STORAGE_STATE, baseURL: WEB_BASE_URL });
    ownerRequest = context.request;
    orgId = await apiOrgId(ownerRequest);
  });

  test("Settings -> Quick post from your phone: creating a link shows the reveal dialog and lists the new link", async ({ page }) => {
    await gotoApp(page);
    await switchOrg(page, LARKSPUR);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Quick post from your phone" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Create link" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Create link" })).toBeVisible();
    await dialog.getByLabel("Label").fill("QA phone");

    // Pick only the Instagram account: locate the "Instagram" platform group heading, then the
    // single checkbox in the accounts list directly below it.
    const igHeading = dialog.getByText("Instagram", { exact: true });
    const igCheckbox = igHeading.locator("xpath=following-sibling::div[1]//input[@type='checkbox']");
    await expect(igCheckbox).toHaveCount(1);
    await igCheckbox.check();

    await expect(dialog.getByRole("tab", { name: "All at once" })).toHaveAttribute("aria-selected", "true");

    await dialog.getByRole("button", { name: "Create link" }).click();
    await expect(dialog.getByRole("heading", { name: "Link created" })).toBeVisible();

    const url = await dialog.getByTestId("quick-link-url").inputValue();
    expect(url).toMatch(/^https?:\/\/[^/]+\/go\/[A-Za-z0-9_-]{20,}$/);
    await expect(dialog.getByTestId("quick-link-qr")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Copy/ })).toBeVisible();

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).not.toBeVisible();

    const row = page.locator("tr", { hasText: "QA phone" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Larkspur Health"); // falls back to the connection's displayName
    await expect(row).toContainText("All at once");
    await expect(row.locator("td").nth(3)).toHaveText("0"); // Uses

    const token = url.split("/go/")[1]!;
    const tokensRes = await ownerRequest.get("/api/quick/tokens", { headers: { "X-Org-Id": orgId } });
    const tokens = await tokensRes.json();
    const record = tokens.find((t: { label: string }) => t.label === "QA phone");
    expect(record).toBeTruthy();
    createdToken = { id: record.id, token, url };
  });

  test("the public phone page shows the org and an Instagram chip, and refuses to post without a photo", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: WEB_BASE_URL, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      await page.goto(`/go/${createdToken.token}`);
      await expect(page.getByText(LARKSPUR)).toBeVisible();
      await expect(page.getByText("@larkspurhealth")).toBeVisible();

      const requestPromise = page
        .waitForRequest((req) => req.url().includes(`/api/quick/${createdToken.token}`) && req.method() === "POST", { timeout: 1_500 })
        .catch(() => null);
      await page.getByRole("button", { name: "Post now" }).click();
      await expect(page.getByText("Add a photo before posting.")).toBeVisible();
      const req = await requestPromise;
      expect(req, "expected no POST to be sent when no photo was chosen").toBeNull();
    } finally {
      await context.close();
    }

    const tokensRes = await ownerRequest.get("/api/quick/tokens", { headers: { "X-Org-Id": orgId } });
    const tokens = await tokensRes.json();
    const record = tokens.find((t: { id: string }) => t.id === createdToken.id);
    expect(record.usesCount).toBe(0);
  });

  test("uploading a photo and a caption posts immediately and shows a live link", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: WEB_BASE_URL, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      await page.goto(`/go/${createdToken.token}`);
      await page.getByTestId("photo-input").setInputFiles(QUICK_PHOTO_FIXTURE);
      await expect(page.getByAltText("Selected photo preview")).toBeVisible();
      await page.getByLabel("Caption").fill("Posted from QA phone");
      await page.getByRole("button", { name: "Post now" }).click();

      const result = page.getByTestId("quick-post-result");
      await expect(result).toBeVisible({ timeout: 15_000 });
      const liveLink = result.locator('a[href^="https://"]');
      await expect(liveLink).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Post another" })).toBeVisible();
    } finally {
      await context.close();
    }

    const postsRes = await ownerRequest.get("/api/posts?includeUnscheduled=1", { headers: { "X-Org-Id": orgId } });
    const posts = await postsRes.json();
    const created = posts.find((p: { caption: string }) => p.caption === "Posted from QA phone");
    expect(created, "expected a post with the submitted caption").toBeTruthy();
    expect(created.status).toBe("published");

    const tokensRes = await ownerRequest.get("/api/quick/tokens", { headers: { "X-Org-Id": orgId } });
    const tokens = await tokensRes.json();
    const record = tokens.find((t: { id: string }) => t.id === createdToken.id);
    expect(record.usesCount).toBe(1);

    const logsRes = await ownerRequest.get("/api/logs?source=quick&limit=200");
    const { entries } = await logsRes.json();
    expect(entries.length).toBeGreaterThan(0);
  });

  test("multipart edge cases: missing caption needs a caption, a transcript is used as-is, unknown tokens 404", async () => {
    const createRes = await ownerRequest.post("/api/quick/tokens", {
      headers: { "X-Org-Id": orgId },
      data: { label: "QA phone edge", connectionIds: [], publishMode: "all" },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    edgeToken = { id: created.id, token: created.token };

    const imageBuffer = fs.readFileSync(QUICK_PHOTO_FIXTURE);

    const needsCaptionRes = await ownerRequest.post(`/api/quick/${edgeToken.token}`, {
      multipart: { image: { name: "photo.jpg", mimeType: "image/jpeg", buffer: imageBuffer } },
    });
    expect(needsCaptionRes.status()).toBe(202);
    const needsCaptionBody = await needsCaptionRes.json();
    expect(needsCaptionBody.status).toBe("needs_caption");

    const transcriptRes = await ownerRequest.post(`/api/quick/${edgeToken.token}`, {
      multipart: {
        image: { name: "photo.jpg", mimeType: "image/jpeg", buffer: imageBuffer },
        transcript: "Voice memo turned into a caption",
      },
    });
    expect(transcriptRes.status()).toBe(201);
    const transcriptBody = await transcriptRes.json();
    expect(transcriptBody.captionSource).toBe("transcript");

    const unknownGetRes = await ownerRequest.get("/api/quick/this-token-does-not-exist");
    expect(unknownGetRes.status()).toBe(404);
    const unknownPostRes = await ownerRequest.post("/api/quick/this-token-does-not-exist", {
      multipart: { image: { name: "photo.jpg", mimeType: "image/jpeg", buffer: imageBuffer } },
    });
    expect(unknownPostRes.status()).toBe(404);
  });

  test("a deactivated token shows the invalid-link message on the phone page", async ({ browser }) => {
    const patchRes = await ownerRequest.patch(`/api/quick/tokens/${edgeToken.id}`, {
      headers: { "X-Org-Id": orgId },
      data: { active: false },
    });
    expect(patchRes.ok()).toBeTruthy();

    const context = await browser.newContext({ baseURL: WEB_BASE_URL });
    const page = await context.newPage();
    try {
      await page.goto(`/go/${edgeToken.token}`);
      await expect(page.getByRole("heading", { name: "Link no longer valid" })).toBeVisible();
      await expect(page.getByText("This quick post link was revoked or never existed.")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("revoking the link removes it from the table", async ({ page }) => {
    await gotoApp(page);
    await switchOrg(page, LARKSPUR);
    await page.goto("/settings");
    const row = page.locator("tr", { hasText: "QA phone" }).filter({ hasNotText: "QA phone edge" });
    await expect(row).toBeVisible();

    await page.getByRole("button", { name: "Revoke QA phone", exact: true }).click();
    const confirm = page.getByRole("dialog").filter({ hasText: "Revoke this link?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Revoke" }).click();
    await expect(confirm).not.toBeVisible();
    await expect(row).toHaveCount(0);
  });
});
