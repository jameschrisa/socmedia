import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InboundBinding } from "@socmedia/shared";
import { renderWithProviders, mockFetch, installMockEventSource, MockEventSource } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { InboundWizard } from "./InboundWizard";

function makeBinding(overrides: Partial<InboundBinding> = {}): InboundBinding {
  return {
    id: "bind-1", channel: "twilio", senderId: "+15555550123", senderLabel: null, userId: "u1", orgId: "org1",
    connectionIds: [], publishMode: "all", confirmBeforePosting: false, status: "pending", verificationCode: "482913",
    createdAt: "2026-09-19T00:00:00Z", verifiedAt: null, lastMessageAt: null,
    ...overrides,
  };
}

describe("InboundWizard", () => {
  beforeEach(() => {
    useAppStore.setState({ currentOrgId: "org1" });
  });

  it("saves Twilio credentials and shows the copyable webhook URL", async () => {
    const { calls } = mockFetch({
      "GET /api/connections": () => [],
      "PUT /api/inbound/channels/twilio": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return { channel: "twilio", enabled: true, webhookUrl: "https://app.example.com/api/inbound/twilio", settings: body.settings };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<InboundWizard open onClose={() => {}} channels={[]} />);

    await user.click(screen.getByTestId("wizard-channel-twilio"));
    await user.click(screen.getByTestId("wizard-next"));

    expect(screen.getByTestId("twilio-webhook-url")).toHaveValue(`${window.location.origin}/api/inbound/twilio`);
    await user.type(screen.getByLabelText("Account SID"), "AC123");
    await user.type(screen.getByLabelText("Auth token"), "secret-token");
    await user.type(screen.getByLabelText("From number"), "+15555550123");
    await user.click(screen.getByTestId("wizard-save-channel"));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.includes("/inbound/channels/twilio"))).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ enabled: true, settings: { accountSid: "AC123", authToken: "secret-token", fromNumber: "+15555550123" } });

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-next")).not.toBeDisabled();
  });

  it("shows a registered check with the bot username after saving Telegram credentials", async () => {
    mockFetch({
      "GET /api/connections": () => [],
      "PUT /api/inbound/channels/telegram": () => ({
        channel: "telegram", enabled: true, webhookUrl: "https://app.example.com/api/inbound/telegram",
        settings: { botToken: "••••6789", botUsername: "suprstar_test_bot" }, webhookRegistered: true,
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<InboundWizard open onClose={() => {}} channels={[]} />);

    await user.click(screen.getByTestId("wizard-channel-telegram"));
    await user.click(screen.getByTestId("wizard-next"));
    await user.type(screen.getByLabelText("Bot token"), "123456:AA-fake-token");
    await user.click(screen.getByTestId("wizard-save-channel"));

    const registered = await screen.findByTestId("telegram-registered");
    expect(registered).toHaveTextContent("Registered as @suprstar_test_bot");
  });

  describe("linking a sender", () => {
    let verified = false;

    beforeEach(() => {
      verified = false;
      installMockEventSource();
    });
    afterEach(() => {
      (globalThis as any).EventSource = undefined;
    });

    it("shows the verification code and flips to Linked when the stream signals an update", async () => {
      mockFetch({
        "GET /api/connections": () => [],
        "PUT /api/inbound/channels/twilio": () => ({ channel: "twilio", enabled: true, webhookUrl: "https://app.example.com/api/inbound/twilio", settings: { accountSid: "ACtest", authToken: "••••", fromNumber: "+15550001111" } }),
        "POST /api/inbound/bindings": () => makeBinding({ status: "pending" }),
        "GET /api/inbound/bindings": () => [makeBinding({ status: verified ? "verified" : "pending" })],
      });
      const user = userEvent.setup();
      renderWithProviders(<InboundWizard open onClose={() => {}} channels={[]} />);

      await user.click(screen.getByTestId("wizard-channel-twilio"));
      await user.click(screen.getByTestId("wizard-next"));
      await user.click(screen.getByTestId("wizard-save-channel"));
      await screen.findByText("Saved");
      await user.click(screen.getByTestId("wizard-next"));

      await user.type(screen.getByLabelText("Phone number"), "+15555550123");
      await user.click(screen.getByTestId("wizard-create-binding"));

      expect(await screen.findByTestId("binding-code")).toHaveTextContent("482913");
      expect(screen.getByTestId("binding-link-status")).toHaveTextContent("Waiting for the code");
      expect(screen.getByTestId("wizard-next")).toBeDisabled();

      verified = true;
      await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
      act(() => {
        MockEventSource.instances[MockEventSource.instances.length - 1]!.dispatch("inbound", { type: "status", status: { channels: [], bindings: 1, transcription: { configured: false, provider: "none" } } });
      });

      await waitFor(() => expect(screen.getByTestId("binding-link-status")).toHaveTextContent("Linked"));
      expect(screen.getByTestId("wizard-next")).not.toBeDisabled();
    });
  });

  it("sends a test message on the Test channel and renders the timeline and reply", async () => {
    let linked = false;
    mockFetch({
      "GET /api/connections": () => [],
      "PUT /api/inbound/channels/test": () => ({ channel: "test", enabled: true, webhookUrl: "https://app.example.com/api/inbound/test", settings: {} }),
      "POST /api/inbound/bindings": () => makeBinding({ channel: "test", senderId: "Jordan's phone", status: "pending" }),
      "PATCH /api/inbound/bindings/:id": () => { linked = true; return makeBinding({ channel: "test", senderId: "Jordan's phone", status: "verified" }); },
      "GET /api/inbound/bindings": () => [makeBinding({ channel: "test", senderId: "Jordan's phone", status: linked ? "verified" : "pending" })],
      "POST /api/inbound/test": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return {
          id: "msg-1", channel: "test", providerMessageId: "test-1", senderId: body.senderId, bindingId: "bind-1",
          orgId: "org1", userId: "u1", text: body.text, mediaCount: 0, hasAudio: false, status: "published",
          postId: "post-1", mediaIds: [], links: [], reply: "Posted to Instagram!", repliedBy: "system", error: null,
          timeline: [{ at: "2026-09-19T00:00:00Z", status: "received", message: "Message received" }],
          receivedAt: "2026-09-19T00:00:00Z", completedAt: "2026-09-19T00:00:05Z",
        };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<InboundWizard open onClose={() => {}} channels={[]} />);

    await user.click(screen.getByTestId("wizard-channel-test"));
    await user.click(screen.getByTestId("wizard-next"));
    // The test channel has nothing to configure; it saves itself, so the Next button unlocks on its own.
    await waitFor(() => expect(screen.getByTestId("wizard-next")).not.toBeDisabled());
    await user.click(screen.getByTestId("wizard-next"));

    await user.type(screen.getByLabelText("Name"), "Jordan's phone");
    await user.click(screen.getByTestId("wizard-create-binding"));
    await user.click(await screen.findByTestId("mark-linked"));
    await waitFor(() => expect(screen.getByTestId("binding-link-status")).toHaveTextContent("Linked"));
    await user.click(screen.getByTestId("wizard-next"));

    // Skip the generated image so jsdom's missing canvas support doesn't get exercised.
    await user.click(screen.getByLabelText("Include a generated image"));
    await user.click(screen.getByTestId("send-test-message"));

    expect(await screen.findByText("Posted to Instagram!")).toBeInTheDocument();
    expect(within(screen.getByTestId("inbound-message-preview")).getByText("Received")).toBeInTheDocument();
  });
});
