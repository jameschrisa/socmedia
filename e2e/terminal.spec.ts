import { createRequire } from "node:module";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { API_BASE_URL, OWNER_STORAGE_STATE, WEB_BASE_URL } from "./constants";
import { gotoApp, inviteUser, signInFreshUser } from "./helpers";

const runId = Date.now();

// Resolved from the server workspace (where "ws" is actually declared) rather than a bare
// `require("ws")`, the same trick global-setup.ts uses for "sharp" -- keeps working regardless of
// where npm happens to hoist it.
const requireFromServer = createRequire(path.join(process.cwd(), "server/package.json"));
const WebSocket = requireFromServer("ws") as typeof import("ws");

async function openTerminal(page: Page): Promise<void> {
  await page.getByTestId("rail-console").click();
  await expect(page).toHaveURL(/\/console$/);
  await page.getByTestId("console-right-tab").getByRole("tab", { name: "Terminal" }).click();
}

interface TerminalStatus {
  enabled: boolean;
  reason: string | null;
  shell: string;
  pty: boolean;
}

test.describe("OS terminal", () => {
  test("owner: the Terminal tab shows the host line with the shell path and an xterm container", async ({ page, request }) => {
    const statusRes = await request.get("/api/terminal/status");
    expect(statusRes.ok()).toBeTruthy();
    const status = (await statusRes.json()) as TerminalStatus;
    expect(status.enabled, "owner should have the terminal enabled outside production").toBe(true);

    await gotoApp(page, "/studio");
    await openTerminal(page);

    const xterm = page.getByTestId("xterm-container");
    await expect(xterm).toBeVisible({ timeout: 10_000 });
    // The header line above the xterm container shows "<user>@<hostname> · <shell> · <cwd>".
    await expect(page.getByText(status.shell, { exact: false })).toBeVisible();
  });

  test("typing 'echo suprstar-e2e' into the xterm produces it in the rendered output", async ({ page, request }) => {
    const statusRes = await request.get("/api/terminal/status");
    const status = (await statusRes.json()) as TerminalStatus;

    await gotoApp(page, "/studio");
    await openTerminal(page);
    await expect(page.getByTestId("xterm-container")).toBeVisible({ timeout: 10_000 });

    const textarea = page.locator(".xterm-helper-textarea");
    await textarea.waitFor({ state: "attached", timeout: 10_000 });
    await textarea.focus();
    await page.keyboard.type("echo suprstar-e2e");
    await page.keyboard.press("Enter");

    const rows = page.locator(".xterm-rows");
    let found = false;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const text = await rows.innerText().catch(() => "");
      if (text.includes("suprstar-e2e")) { found = true; break; }
      await page.waitForTimeout(500);
    }

    if (!found) {
      const text = await rows.innerText().catch(() => "");
      const pipeFallback = status.pty === false || /no native pty available/i.test(text);
      test.skip(pipeFallback, "No usable pseudo-terminal on this host (plain-pipe fallback): the fallback shell does not reliably echo typed input back into the output stream, so this assertion can't hold here.");
      // status claimed a real pty was available and there's no fallback banner in the output --
      // this is a real failure, not an environment quirk.
      expect(text, "expected the shell to echo the command's output").toContain("suprstar-e2e");
    }
  });

  test("Disconnect and Restart shell work", async ({ page }) => {
    await gotoApp(page, "/studio");
    await openTerminal(page);
    await expect(page.getByTestId("xterm-container")).toBeVisible({ timeout: 10_000 });

    const disconnectBtn = page.getByRole("button", { name: "Disconnect" });
    await expect(disconnectBtn).toBeVisible({ timeout: 10_000 });
    await disconnectBtn.click();

    const newSessionBtn = page.getByRole("button", { name: /New session/ });
    await expect(newSessionBtn).toBeVisible();
    await newSessionBtn.click();

    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible({ timeout: 10_000 });
  });

  test("a viewer sees the disabled explanation and GET /api/terminal/status reports enabled: false with a reason", async ({ browser }) => {
    const ownerContext = await browser.newContext({ storageState: OWNER_STORAGE_STATE, baseURL: WEB_BASE_URL });
    const ownerPage = await ownerContext.newPage();
    let viewer;
    try {
      viewer = await inviteUser(ownerPage, { name: "Val Terminal", email: `viewer-terminal-${runId}@suprstar.test`, role: "viewer" });
    } finally {
      await ownerContext.close();
    }

    const { context, page } = await signInFreshUser(browser, { email: viewer.email, tempPassword: viewer.password });
    try {
      const statusRes = await context.request.get("/api/terminal/status");
      expect(statusRes.ok()).toBeTruthy();
      const status = (await statusRes.json()) as TerminalStatus;
      expect(status.enabled).toBe(false);
      expect(status.reason).toBeTruthy();
      expect(status.reason).toMatch(/owners and admins/i);

      await gotoApp(page, "/studio");
      await openTerminal(page);
      await expect(page.getByTestId("terminal-disabled")).toBeVisible();
      await expect(page.getByTestId("terminal-disabled")).toContainText(status.reason!);
    } finally {
      await context.close();
    }
  });

  test("an unauthenticated WebSocket to /api/terminal is refused", async () => {
    const wsUrl = `${API_BASE_URL.replace(/^http/, "ws")}/api/terminal?cols=80&rows=24`;
    const ws = new WebSocket(wsUrl);

    const outcome = await new Promise<{ kind: "open" } | { kind: "unexpected-response"; status: number } | { kind: "error" }>((resolve) => {
      ws.on("open", () => resolve({ kind: "open" }));
      ws.on("unexpected-response", (_req: unknown, res: { statusCode: number }) => resolve({ kind: "unexpected-response", status: res.statusCode }));
      ws.on("error", () => resolve({ kind: "error" }));
      setTimeout(() => resolve({ kind: "error" }), 8_000);
    });

    expect(outcome.kind, "an unauthenticated caller must never get a working socket").not.toBe("open");
    if (outcome.kind === "unexpected-response") {
      expect(outcome.status).toBe(401);
    }
    ws.terminate();
  });
});
