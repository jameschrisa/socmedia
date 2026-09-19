import { test, expect, type Page } from "@playwright/test";
import { OWNER_EMAIL, OWNER_STORAGE_STATE, WEB_BASE_URL } from "./constants";
import { gotoApp, inviteUser, signInFreshUser, type InvitedUser } from "./helpers";

const runId = Date.now();

/**
 * Matches one rendered `LogLine`'s DOM text content and captures its source. The level/source spans
 * are visually uppercased via CSS (`text-transform`), but `textContent` reflects the underlying
 * (lowercase) data, and adjacent `<span>`s with no literal whitespace between them in JSX render
 * with no space in between either -- so this intentionally doesn't require any separators.
 */
const LOG_LINE_RE = /^\d{2}:\d{2}:\d{2}(debug|info|warn|error)([a-z]+)/;

async function openConsole(page: Page): Promise<void> {
  await page.getByTestId("rail-console").click();
  await expect(page.getByRole("region", { name: "Console" })).toBeVisible();
}

/** All rendered terminal lines, newest last. */
async function terminalLines(page: Page): Promise<string[]> {
  return page.getByTestId("console-scroll").locator(".term-line").allTextContents();
}

/** Sources of every server-log (non-local-echo) line currently rendered. */
async function logLineSources(page: Page): Promise<string[]> {
  const lines = await terminalLines(page);
  return lines.map((l) => l.match(LOG_LINE_RE)?.[2]).filter((s): s is string => !!s);
}

async function runCommand(page: Page, text: string): Promise<void> {
  const input = page.getByLabel("Console command");
  await input.fill(text);
  await input.press("Enter");
}

test.describe("agent console", () => {
  test("rail-console opens the Console drawer, Ctrl+` toggles it, and its height persists across a reload", async ({ page }) => {
    await gotoApp(page);
    const region = page.getByRole("region", { name: "Console" });

    await page.getByTestId("rail-console").click();
    await expect(region).toBeVisible();

    await page.keyboard.press("Control+Backquote");
    await expect(region).not.toBeVisible();
    await page.keyboard.press("Control+Backquote");
    await expect(region).toBeVisible();

    const drawer = page.getByTestId("console-drawer");
    const before = (await drawer.boundingBox())!.height;

    // Resize from the keyboard: the drag handle is a `role="separator"` that responds to arrow keys
    // (+24px per press). Wait for each press to land before sending the next one, so a stale-closure
    // regression (state update not yet applied when the next keydown fires) would show up as a real failure.
    const handle = page.getByTestId("console-drag-handle");
    await handle.focus();
    let last = before;
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ArrowUp");
      await expect.poll(async () => (await drawer.boundingBox())!.height, { timeout: 2_000 }).toBeGreaterThan(last);
      last = (await drawer.boundingBox())!.height;
    }
    const afterResize = last;
    expect(afterResize).toBeGreaterThanOrEqual(before + 5 * 24 - 4);

    await page.reload();
    await expect(page.getByRole("region", { name: "Console" })).toBeVisible();
    const afterReload = (await page.getByTestId("console-drawer").boundingBox())!.height;
    expect(Math.abs(afterReload - afterResize)).toBeLessThanOrEqual(4);
  });

  test("shows recent server activity and streams new lines in without a reload", async ({ page }) => {
    await gotoApp(page);
    await openConsole(page);

    await expect.poll(async () => logLineSources(page), { timeout: 10_000 }).toContain("http");

    // Trigger a fresh request via normal in-app navigation (no page reload, so the SSE connection
    // -- and the console's local state -- survives) and confirm it streams straight into the terminal.
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Social Profiles" }).click();
    await expect.poll(
      async () => (await terminalLines(page)).some((l) => l.includes("GET /api/connections")),
      { timeout: 30_000 },
    ).toBe(true);
  });

  test("filters narrow the visible lines by source and by text", async ({ page }) => {
    await gotoApp(page);
    await openConsole(page);
    await expect.poll(async () => logLineSources(page), { timeout: 10_000 }).toContain("http");

    await runCommand(page, "/status");
    await expect(page.getByText(/Scheduler:/)).toBeVisible();

    await page.getByLabel("Filter by source").selectOption("agent");
    await expect.poll(async () => logLineSources(page), { timeout: 10_000 }).toContain("agent");
    // Every *server log* line left after the source filter must itself be source=agent; local
    // command-echo/reply lines aren't tagged with a source and are exempt from this check.
    await expect.poll(async () => {
      const sources = await logLineSources(page);
      return sources.every((s) => s === "agent");
    }).toBe(true);

    await page.getByLabel("Filter by source").selectOption("");
    await expect.poll(async () => logLineSources(page), { timeout: 10_000 }).toContain("http");
    const beforeTextFilter = (await terminalLines(page)).length;
    await page.getByLabel("Search log messages").fill("scheduler");
    // The filter is applied per logical item (a log line, or a whole command+reply exchange), not
    // per raw rendered line, so an agent reply that mentions "Scheduler" keeps its non-matching
    // action-summary lines too. Assert the echoed "/status" command (which itself has no match) is
    // gone, the matching reply text is still there, and the overall count actually shrank.
    await expect.poll(async () => (await terminalLines(page)).length).toBeLessThan(beforeTextFilter);
    await expect(page.getByText("you ❯", { exact: false })).toHaveCount(0);
    await expect(page.getByText(/Scheduler:/)).toBeVisible();
  });

  test("slash commands: /status, /help, /whoami, an offline-mock reply, /clear and history recall", async ({ page }) => {
    await gotoApp(page);
    await openConsole(page);

    await runCommand(page, "/status");
    await expect(page.getByText(/Scheduler: ticking every/)).toBeVisible();

    await runCommand(page, "/help");
    await expect(page.getByText("/publish <postId>: publish a post now (write role)")).toBeVisible();

    await runCommand(page, "/whoami");
    await expect(page.getByText(new RegExp(`<${OWNER_EMAIL.replace(".", "\\.")}>`))).toBeVisible();

    // No AI provider is configured in this environment, so free-form input falls back to the
    // deterministic offline mock, which explains that an AI provider needs to be configured.
    await runCommand(page, "what a wonderful console this is");
    await expect(page.getByText(/AI provider/i)).toBeVisible();

    await runCommand(page, "/clear");
    await expect(page.getByTestId("console-empty")).toBeVisible();

    const input = page.getByLabel("Console command");
    await input.click();
    await page.keyboard.press("ArrowUp");
    await expect(input).toHaveValue("what a wonderful console this is");
  });

  test("owner sees a Log files tab listing rotated app logs with viewable content", async ({ page }) => {
    await gotoApp(page);
    await openConsole(page);
    await page.getByRole("tab", { name: "Log files" }).click();

    const fileButton = page.locator("button", { hasText: /^app-\d{4}-\d{2}-\d{2}\.log/ }).first();
    await expect(fileButton).toBeVisible({ timeout: 10_000 });
    await fileButton.click();
    await expect(page.locator("pre")).not.toHaveText("This file is empty.");
    await expect(page.locator("pre")).not.toHaveText("");
  });

  test("a viewer has no Log files tab, is 403'd from the files API, and gets a refusal (not a publish) from a write slash command", async ({ browser }) => {
    const ownerContext = await browser.newContext({ storageState: OWNER_STORAGE_STATE, baseURL: WEB_BASE_URL });
    const ownerPage = await ownerContext.newPage();
    let viewer: InvitedUser;
    try {
      viewer = await inviteUser(ownerPage, { name: "Val Console", email: `viewer-console-${runId}@suprstar.test`, role: "viewer" });
    } finally {
      await ownerContext.close();
    }

    const { context, page } = await signInFreshUser(browser, { email: viewer.email, tempPassword: viewer.password });
    try {
      await gotoApp(page);
      await openConsole(page);
      await expect(page.getByRole("tab", { name: "Log files" })).toHaveCount(0);

      const filesRes = await context.request.get("/api/logs/files");
      expect(filesRes.status()).toBe(403);

      // A viewer typing a write slash command must not be able to publish anything; the app should
      // refuse the action in the reply rather than mutate state (some form of "cannot"/403, but never a publish).
      const orgsRes = await context.request.get("/api/orgs");
      const orgs = await orgsRes.json();
      const cmdRes = await context.request.post("/api/agent/commands", {
        headers: { "X-Org-Id": orgs[0].id },
        data: { input: "/publish some-post-id" },
      });
      if (cmdRes.status() === 403) {
        // Acceptable alternative: the endpoint itself rejects the write outright.
        expect(cmdRes.status()).toBe(403);
      } else {
        expect(cmdRes.ok()).toBeTruthy();
        const body = await cmdRes.json();
        expect(body.reply.toLowerCase()).toMatch(/cannot|viewer|forbidden|not allowed/);
        const action = body.actions.find((a: { tool: string }) => a.tool === "publish_post");
        expect(action?.ok).toBe(false);
      }
    } finally {
      await context.close();
    }
  });
});
