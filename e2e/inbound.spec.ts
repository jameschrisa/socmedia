import crypto from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { API_BASE_URL, OWNER_EMAIL, OWNER_STORAGE_STATE, WEB_BASE_URL } from "./constants";
import { gotoApp, inviteUser, signInFreshUser, switchOrg } from "./helpers";

const runId = Date.now();
const LARKSPUR = "Larkspur Health";
/** A real, tiny (1x1) transparent PNG, used wherever the test channel needs an "image" without a browser canvas. */
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/** Twilio's request-validation algorithm: HMAC-SHA1 of the full URL + sorted POST params, base64-encoded.
 * Mirrors `computeTwilioSignature` in server/src/inbound/twilio.ts so a test client can sign a webhook
 * exactly the way Twilio itself would, without importing server internals. */
function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

let orgId: string;
let ownerRequest: APIRequestContext;

async function apiOrgId(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/orgs");
  const orgs: { id: string; name: string }[] = await res.json();
  const larkspur = orgs.find((o) => o.name === LARKSPUR);
  expect(larkspur, `expected a seeded "${LARKSPUR}" org`).toBeTruthy();
  return larkspur!.id;
}

// Deliberately *not* `mode: "serial"`: the suite's single global worker (playwright.config.ts)
// already runs every test in this file in declaration order, and later tests build on state left
// by earlier ones (the qa-phone binding, the saved Twilio credentials, ...). Serial mode would add
// one behavior on top of that we don't want here: a failed test skips every later test in the file,
// which would hide the rest of this round's coverage behind the known, `expect.soft`-guarded defect
// in the first test below (see QA-REPORT.md).

test.describe("inbound messaging", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: OWNER_STORAGE_STATE, baseURL: WEB_BASE_URL });
    ownerRequest = context.request;
    orgId = await apiOrgId(ownerRequest);
  });

  test("wizard: set up the test channel, link qa-phone, send a test message end to end", async ({ page }) => {
    await gotoApp(page);
    await switchOrg(page, LARKSPUR);

    // Settings no longer hosts "Post from chat" at all -- only a pointer card to Remote Posting.
    await page.goto("/settings");
    await expect(page.getByText("Post from chat")).toHaveCount(0);
    const movedCard = page.getByTestId("remote-posting-moved");
    await expect(movedCard).toBeVisible();

    await page.goto("/remote#chat");
    await expect(page.getByTestId("remote-tabs").getByRole("tab", { name: "Chat channels" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("inbound-section")).toBeVisible();

    await page.getByTestId("setup-channel").click();
    const wizard = page.getByTestId("inbound-wizard");
    await expect(wizard).toBeVisible();

    // Step 1: channel. "Try the pipeline without a provider" is the test channel's blurb.
    await expect(wizard.getByTestId("wizard-channel-test")).toContainText("Try the pipeline without a provider");
    await wizard.getByTestId("wizard-channel-test").click();
    await wizard.getByTestId("wizard-next").click();

    // Step 2: credentials. The test channel has nothing to configure, so Next unlocks on its own.
    await expect(wizard.getByTestId("wizard-next")).toBeEnabled();
    await wizard.getByTestId("wizard-next").click();

    // Step 3: link a sender.
    await wizard.getByLabel("Name").fill("qa-phone");
    await wizard.getByLabel("Label").fill("QA");
    // Leave every account checkbox unchecked ("leave all unchecked to post to every enabled account")
    // and leave publish mode on its default, "All at once".
    await wizard.getByTestId("wizard-create-binding").click();

    // `expect.soft` here (not a plain `expect`): this exact assertion caught a real defect earlier
    // in this round (the freshly created binding's `verificationCode` was clobbered almost immediately
    // by the wizard's own bindings poll -- see "Round 5 defects: now fixed" in QA-REPORT.md), which
    // would otherwise have taken the rest of this end-to-end flow down with it. Left soft on purpose
    // so a regression here is reported without hiding every other assertion below it.
    const code = wizard.getByTestId("binding-code");
    await expect.soft(code, "the verification code should stay visible after creating the binding").toHaveText(/^\d{6}$/);
    await expect(wizard.getByTestId("binding-link-status")).toContainText("Waiting for the code");
    await wizard.getByTestId("mark-linked").click();
    await expect(wizard.getByTestId("binding-link-status")).toContainText("Linked");
    await wizard.getByTestId("wizard-next").click();

    // Step 4: send a test message, with the generated image left on.
    await expect(wizard.getByLabel("Include a generated image")).toBeChecked();
    await wizard.getByLabel("Caption").fill("Posted from chat");
    await wizard.getByTestId("send-test-message").click();

    const preview = wizard.getByTestId("inbound-message-preview");
    await expect(preview).toBeVisible({ timeout: 15_000 });
    const timelineText = await preview.locator("ol").innerText();
    expect(timelineText, "expected the timeline to show received -> published -> reply sent").toMatch(/received/i);
    expect(timelineText).toMatch(/published/i);
    expect(timelineText).toMatch(/reply sent/i);
    await expect(preview.locator('a[target="_blank"]').first()).toBeVisible();
    await expect(preview.getByText(/Reply from the system/i)).toBeVisible();

    // Step 5: done.
    await wizard.getByTestId("wizard-next").click();
    await wizard.getByTestId("wizard-done").click();
    await expect(wizard).not.toBeVisible();

    // The monitor lists the message with a published badge.
    const row = page.getByTestId("inbound-message-row").filter({ hasText: "QA" }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("Published");

    // The bindings table shows qa-phone as verified.
    const bindingRow = page.getByTestId("inbound-binding-row").filter({ hasText: "QA" });
    await expect(bindingRow).toContainText("Verified");
  });

  test("Twilio wizard: credentials save, webhook URL, listening chip, masked on reopen", async ({ page }) => {
    await gotoApp(page);
    await page.goto("/remote#chat");
    await expect(page.getByTestId("inbound-section")).toBeVisible();
    await page.getByTestId("setup-channel").click();

    const wizard = page.getByTestId("inbound-wizard");
    await wizard.getByTestId("wizard-channel-twilio").click();
    await wizard.getByTestId("wizard-next").click();

    await wizard.getByLabel("Account SID").fill("ACtest");
    await wizard.getByLabel("Auth token", { exact: true }).fill("secret-token");
    await wizard.getByLabel("From number").fill("+15550001111");
    await wizard.getByTestId("wizard-save-channel").click();
    await expect(wizard.getByText("Saved")).toBeVisible();

    // The webhook URL is pinned to the API's own origin (PUBLIC_BASE_URL, see playwright.config.ts)
    // so it's deterministic and matches what inbound.spec.ts signs webhook requests against.
    await expect(wizard.getByTestId("twilio-webhook-url")).toHaveValue(`${API_BASE_URL}/api/inbound/twilio`);

    // Reload before reopening via "Edit" so the wizard picks up the freshly saved (masked) config
    // from a clean fetch, exactly like a user coming back to Remote Posting later would.
    await page.reload();
    await expect(page.getByTestId("inbound-section")).toBeVisible();
    await expect(page.getByTestId("inbound-chip-twilio")).toContainText("Listening", { timeout: 10_000 });

    await page.getByTestId("inbound-edit-twilio").click();
    await expect(wizard).toBeVisible();
    await expect(wizard.getByLabel("Auth token", { exact: true })).toHaveValue(/^••••/);
  });

  test("Twilio webhook: valid signature accepted, wrong signature rejected, duplicate MessageSid ignored", async ({ request }) => {
    const url = `${API_BASE_URL}/api/inbound/twilio`;
    const params = { From: "+15550002222", Body: "hello", MessageSid: "SM1", NumMedia: "0" };
    const signature = twilioSignature("secret-token", url, params);

    const res = await request.post(url, { form: params, headers: { "X-Twilio-Signature": signature } });
    expect(res.status()).toBe(200);
    expect((await res.text()).trim()).toBe("<Response/>");
    expect(res.headers()["content-type"]).toContain("xml");

    await expect
      .poll(async () => {
        const list = await (await request.get("/api/inbound/messages?channel=twilio")).json();
        return list.find((m: { senderId: string }) => m.senderId === params.From)?.status;
      }, { timeout: 10_000 })
      .toBe("unknown_sender");

    const wrongSignature = twilioSignature("a-completely-different-token", url, params);
    const wrongRes = await request.post(url, {
      form: { ...params, MessageSid: "SM-wrong-sig" },
      headers: { "X-Twilio-Signature": wrongSignature },
    });
    expect(wrongRes.status()).toBe(403);

    // Re-deliver the exact same (valid) request Twilio would retry on a timeout; must not double-process.
    const dupRes = await request.post(url, { form: params, headers: { "X-Twilio-Signature": signature } });
    expect(dupRes.status()).toBe(200);
    await expect
      .poll(async () => {
        const list = await (await request.get("/api/inbound/messages?channel=twilio")).json();
        return list.filter((m: { senderId: string }) => m.senderId === params.From).length;
      }, { timeout: 10_000 })
      .toBe(1);
  });

  test("confirm-before-posting: awaiting confirmation, a YES publishes it, Discard ignores another", async ({ page, request }) => {
    const createRes = await request.post("/api/inbound/bindings", {
      headers: { "X-Org-Id": orgId },
      data: { channel: "test", senderId: "qa-confirm", senderLabel: "Confirm Sender", confirmBeforePosting: true },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const binding = await createRes.json();

    const verifyRes = await request.patch(`/api/inbound/bindings/${binding.id}`, { data: { status: "verified" } });
    expect(verifyRes.ok(), await verifyRes.text()).toBeTruthy();

    const firstRes = await request.post("/api/inbound/test", {
      data: { senderId: "qa-confirm", text: "Fresh from the field", imageUrl: TINY_PNG_DATA_URL },
    });
    expect(firstRes.ok(), await firstRes.text()).toBeTruthy();
    const awaiting = await firstRes.json();
    expect(awaiting.status).toBe("awaiting_confirmation");
    expect(awaiting.reply).toContain("YES");

    const yesRes = await request.post("/api/inbound/test", { data: { senderId: "qa-confirm", text: "yes" } });
    expect(yesRes.ok(), await yesRes.text()).toBeTruthy();

    await expect
      .poll(async () => (await (await request.get(`/api/inbound/messages/${awaiting.id}`)).json()).status, { timeout: 10_000 })
      .toBe("published");

    // A second message, discarded through the monitor UI instead of the API.
    const secondRes = await request.post("/api/inbound/test", {
      data: { senderId: "qa-confirm", text: "Another one", imageUrl: TINY_PNG_DATA_URL },
    });
    expect(secondRes.ok(), await secondRes.text()).toBeTruthy();
    const second = await secondRes.json();
    expect(second.status).toBe("awaiting_confirmation");

    await gotoApp(page);
    await page.goto("/remote#chat");
    await expect(page.getByTestId("inbound-section")).toBeVisible();
    const row = page
      .getByTestId("inbound-message-row")
      .filter({ hasText: "Confirm Sender" })
      .filter({ hasText: "Awaiting confirmation" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await page.getByTestId("discard-message").click();

    await expect
      .poll(async () => (await (await request.get(`/api/inbound/messages/${second.id}`)).json()).status, { timeout: 10_000 })
      .toBe("ignored");
  });

  test("slash commands from a linked sender: /status and /whoami run through the agent", async ({ request }) => {
    const statusRes = await request.post("/api/inbound/test", { data: { senderId: "qa-phone", text: "/status" } });
    expect(statusRes.ok(), await statusRes.text()).toBeTruthy();
    const statusMsg = await statusRes.json();
    expect(statusMsg.status).toBe("command");
    expect(statusMsg.repliedBy).toBe("agent");
    expect(statusMsg.reply).toContain("Scheduler");

    const whoamiRes = await request.post("/api/inbound/test", { data: { senderId: "qa-phone", text: "/whoami" } });
    expect(whoamiRes.ok(), await whoamiRes.text()).toBeTruthy();
    const whoamiMsg = await whoamiRes.json();
    expect(whoamiMsg.reply).toContain(OWNER_EMAIL);
  });

  test("voice transcription: status reports unconfigured, then configured with a masked key once saved, then back off", async ({ page, request }) => {
    const before = await (await request.get("/api/inbound/status")).json();
    expect(before.transcription.configured).toBe(false);

    await gotoApp(page);
    await page.goto("/remote#chat");
    const row = page.getByTestId("transcription-row");
    await expect(row).toBeVisible();
    await row.getByLabel("Voice transcription").selectOption("openai");
    await row.getByLabel("API key").fill("sk-test-123456");
    await row.getByTestId("save-transcription").click();
    await expect(page.getByText("Transcription settings saved")).toBeVisible();

    await expect
      .poll(async () => (await (await request.get("/api/inbound/status")).json()).transcription.configured, { timeout: 10_000 })
      .toBe(true);
    const afterSave = await (await request.get("/api/inbound/transcription")).json();
    expect(afterSave.provider).toBe("openai");
    expect(afterSave.apiKey).toMatch(/^••••/);

    // Restore "none" so this doesn't leak into any other round's tests.
    await row.getByLabel("Voice transcription").selectOption("none");
    await row.getByTestId("save-transcription").click();
    await expect
      .poll(async () => (await (await request.get("/api/inbound/status")).json()).transcription.configured, { timeout: 10_000 })
      .toBe(false);
  });

  test("live status: the right-rail popover and the Console activity log both reflect inbound activity", async ({ page }) => {
    await gotoApp(page, "/studio");
    await page.getByTestId("rail-inbound").click();
    const panel = page.getByRole("dialog", { name: "Inbound" });
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("rail-inbound-chip-test")).toContainText("Listening");
    await expect(panel.getByText(/No messages yet\./)).toHaveCount(0);
    // This popover isn't a Modal (no Escape handler); close it via its own Close button so the
    // fixed backdrop it renders doesn't linger and intercept the next click.
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).not.toBeVisible();

    await page.getByTestId("rail-console").click();
    await expect(page).toHaveURL(/\/console$/);
    await expect(page.getByLabel("Console command")).toBeVisible();
    await page.getByLabel("Filter by source").selectOption("inbound");
    await expect
      .poll(async () => page.getByTestId("console-scroll").locator(".term-line").allTextContents(), { timeout: 10_000 })
      .toEqual(expect.arrayContaining([expect.stringMatching(/message received/i)]));
  });

  test("a viewer gets 403 from GET /api/inbound/status and sees no Post from chat section", async ({ page, browser }) => {
    const viewer = await inviteUser(page, { name: "Ivy Viewer", email: `ivy-${runId}@suprstar.test`, role: "viewer" });
    const { context, page: viewerPage } = await signInFreshUser(browser, { email: viewer.email, tempPassword: viewer.password });
    try {
      const res = await context.request.get("/api/inbound/status");
      expect(res.status()).toBe(403);

      await gotoApp(viewerPage);
      await expect(viewerPage.getByTestId("rail-inbound")).toHaveCount(0);
      await viewerPage.goto("/settings");
      await expect(viewerPage.getByText("Post from chat")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
