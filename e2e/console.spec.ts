import { test, expect, type Page } from "@playwright/test";
import { OWNER_EMAIL, OWNER_STORAGE_STATE, WEB_BASE_URL } from "./constants";
import { gotoApp, inviteUser, signInFreshUser, switchOrg, type InvitedUser } from "./helpers";

const runId = Date.now();

/**
 * Matches one rendered log line's DOM text content and captures its source. The level/source spans
 * are visually uppercased via CSS (`text-transform`), but `textContent` reflects the underlying
 * (lowercase) data, and adjacent `<span>`s with no literal whitespace between them in JSX render
 * with no space in between either -- so this intentionally doesn't require any separators.
 */
const LOG_LINE_RE = /^\d{2}:\d{2}:\d{2}(debug|info|warn|error)([a-z]+)/;

/** Clicks the rail button and waits for the full-page console (both panes) to be ready. */
async function openConsole(page: Page): Promise<void> {
  await page.getByTestId("rail-console").click();
  await expect(page).toHaveURL(/\/console$/);
  await expect(page.getByLabel("Console command")).toBeVisible();
  await expect(page.getByTestId("console-right-tab")).toBeVisible();
}

/** All rendered lines in the Agent pane's transcript (echoed commands + replies), newest last. */
async function agentLines(page: Page): Promise<string[]> {
  return page.getByTestId("agent-scroll").locator(".term-line").allTextContents();
}

/** All rendered lines in the Activity log pane's stream, newest last. */
async function logLines(page: Page): Promise<string[]> {
  return page.getByTestId("console-scroll").locator(".term-line").allTextContents();
}

/** Sources of every server-log line in a set of rendered Activity-log lines. */
function logSources(lines: string[]): string[] {
  return lines.map((l) => l.match(LOG_LINE_RE)?.[2]).filter((s): s is string => !!s);
}

async function runCommand(page: Page, text: string): Promise<void> {
  const input = page.getByLabel("Console command");
  await input.fill(text);
  await input.press("Enter");
}

test.describe("agent console (full page)", () => {
  test("rail-console opens /console with both panes, Ctrl+` toggles it, and Close returns to the previous route", async ({ page }) => {
    await gotoApp(page, "/studio");
    await expect(page).toHaveURL(/\/studio$/);

    await openConsole(page);
    await expect(page.getByTestId("agent-scroll")).toBeVisible();
    await expect(page.getByTestId("console-scroll")).toBeVisible();

    await page.keyboard.press("Control+Backquote");
    await expect(page).toHaveURL(/\/studio$/);
    // Wait for AppShell (and its own Ctrl+` "open" listener, replacing the console page's "close"
    // listener) to actually finish mounting before firing the next shortcut.
    await expect(page.getByTestId("org-switcher")).toBeVisible();

    await page.keyboard.press("Control+Backquote");
    await expect(page).toHaveURL(/\/console$/);

    await page.getByTestId("console-close").click();
    await expect(page).toHaveURL(/\/studio$/);
  });

  test("rail-console-mobile opens the console on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await gotoApp(page, "/studio");
    await page.getByTestId("rail-console-mobile").click();
    await expect(page).toHaveURL(/\/console$/);
    await expect(page.getByLabel("Console command")).toBeVisible();
  });

  test("the split handle resizes the panes from the keyboard and the split persists across a reload", async ({ page }) => {
    await gotoApp(page, "/studio");
    await openConsole(page);

    const handle = page.getByTestId("console-split-handle");
    await expect(handle).toHaveAttribute("aria-valuenow", "50");

    await handle.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "60");

    await page.reload();
    await expect(page.getByLabel("Console command")).toBeVisible();
    await expect(page.getByTestId("console-split-handle")).toHaveAttribute("aria-valuenow", "60");
  });

  test("console-right-tab toggles between Activity log and Terminal", async ({ page }) => {
    await gotoApp(page, "/studio");
    await openConsole(page);
    await expect(page.getByTestId("console-scroll")).toBeVisible();

    await page.getByTestId("console-right-tab").getByRole("tab", { name: "Terminal" }).click();
    await expect(page.getByTestId("xterm-container").or(page.getByTestId("terminal-disabled"))).toBeVisible();
    await expect(page.getByTestId("console-scroll")).toHaveCount(0);

    await page.getByTestId("console-right-tab").getByRole("tab", { name: "Activity log" }).click();
    await expect(page.getByTestId("console-scroll")).toBeVisible();
  });

  test("the Activity log pane shows recent server activity and streams a new line via a request in the same browser context", async ({ page }) => {
    await gotoApp(page, "/studio");
    await openConsole(page);

    await expect.poll(async () => logSources(await logLines(page)), { timeout: 10_000 }).toContain("http");

    const before = (await logLines(page)).length;
    // A request through the shared session (no page reload, so the SSE connection survives) that
    // this page can't have already fired on its own -- proves the stream, not just the initial fetch.
    const res = await page.request.get("/api/docs/platforms/status");
    expect(res.ok()).toBeTruthy();

    await expect.poll(async () => (await logLines(page)).length, { timeout: 15_000 }).toBeGreaterThan(before);
    await expect(page.getByTestId("console-scroll")).toContainText("GET /api/docs/platforms/status");
  });

  test("filters narrow the visible log lines by source and by text", async ({ page }) => {
    await gotoApp(page, "/studio");
    await openConsole(page);
    await expect.poll(async () => logSources(await logLines(page)), { timeout: 10_000 }).toContain("http");

    // Running a slash command guarantees a fresh, deterministic "agent"-source log entry (every
    // command is logged) and a "POST /api/agent/commands" http entry to filter for below.
    await runCommand(page, "/status");
    await expect.poll(async () => logSources(await logLines(page)), { timeout: 10_000 }).toContain("agent");

    await page.getByLabel("Filter by source").selectOption("agent");
    await expect.poll(async () => {
      const sources = logSources(await logLines(page));
      return sources.length > 0 && sources.every((s) => s === "agent");
    }, { timeout: 10_000 }).toBe(true);

    await page.getByLabel("Filter by source").selectOption("");
    await expect.poll(async () => logSources(await logLines(page)), { timeout: 10_000 }).toContain("http");

    // Resetting the source filter reconnects the SSE stream and replaces the buffer with a fresh
    // last-200-entries snapshot, so run the command whose request we'll search for *after* that
    // reset (no further filter changes happen before we search) rather than reusing the /status
    // call above, which could otherwise have already aged out of the snapshot on a busy shared server.
    await runCommand(page, "/whoami");
    await expect.poll(async () => (await logLines(page)).some((l) => l.includes("POST /api/agent/commands")), { timeout: 10_000 }).toBe(true);

    const beforeCount = (await logLines(page)).length;
    await page.getByLabel("Search log messages").fill("agent/commands");
    await expect.poll(async () => (await logLines(page)).length, { timeout: 10_000 }).toBeLessThan(beforeCount);
    const remaining = await logLines(page);
    expect(remaining.length).toBeGreaterThan(0);
    for (const line of remaining) expect(line.toLowerCase()).toContain("agent/commands");
  });

  test("slash commands: /status, /help, /whoami, /docs, an offline-mock reply, /clear and history recall", async ({ page }) => {
    await gotoApp(page, "/studio");
    await openConsole(page);

    await runCommand(page, "/status");
    await expect(page.getByText(/Scheduler: ticking every/)).toBeVisible();

    await runCommand(page, "/help");
    await expect(page.getByText("/docs <platform?> <query>: search the platform developer-docs knowledge base")).toBeVisible();
    await expect(page.getByText("/diagnose <connectionId|platform>: bundle a connection's status, last test, recent jobs and doc hits")).toBeVisible();

    await runCommand(page, "/whoami");
    await expect(page.getByText(new RegExp(`<${OWNER_EMAIL.replace(".", "\\.")}>`))).toBeVisible();

    // No AI provider is configured in this environment, so free-form input falls back to the
    // deterministic offline mock, which explains that an AI provider needs to be configured.
    await runCommand(page, "what a wonderful console this is");
    await expect(page.getByText(/AI provider/i)).toBeVisible();

    await runCommand(page, "/docs youtube invalid_grant");
    await expect.poll(async () => {
      const text = (await agentLines(page)).join("\n");
      return /oauth|errors/i.test(text) && text.includes("docs/platforms");
    }, { timeout: 10_000 }).toBe(true);

    await runCommand(page, "/clear");
    await expect(page.getByTestId("agent-empty")).toBeVisible();

    const input = page.getByLabel("Console command");
    await input.click();
    await page.keyboard.press("ArrowUp");
    await expect(input).toHaveValue("/docs youtube invalid_grant");
  });

  test("/diagnose x reports the org's X account status", async ({ page, request }) => {
    const orgRes = await request.post("/api/orgs", {
      data: { name: `Diagnose QA ${runId}`, brandColor: "#1D9BF0", timezone: "UTC" },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const org = await orgRes.json();

    // A freshly created org's X account is a disconnected sandbox account, so the reply is
    // deterministic regardless of what other specs have done to shared orgs.
    await gotoApp(page, "/studio");
    await switchOrg(page, org.name);

    await openConsole(page);
    await runCommand(page, "/diagnose x");
    await expect.poll(async () => {
      const text = (await agentLines(page)).join("\n");
      return /\bx\b/i.test(text) && /disconnected/i.test(text);
    }, { timeout: 10_000 }).toBe(true);
  });

  test("Documentation rail search finds a YouTube/Google hit for redirect_uri_mismatch", async ({ page }) => {
    await gotoApp(page, "/studio");
    await page.getByTestId("rail-docs").click();
    await page.getByTestId("platform-docs-input").fill("redirect_uri_mismatch");

    const hits = page.getByTestId("platform-docs-hit");
    await expect(hits.first()).toBeVisible({ timeout: 10_000 });
    const texts = await hits.allTextContents();
    expect(texts.some((t) => /youtube|google/i.test(t))).toBe(true);
  });

  test("owner sees a Log files tab listing rotated app logs with viewable content", async ({ page }) => {
    await gotoApp(page, "/studio");
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
      await gotoApp(page, "/studio");
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
