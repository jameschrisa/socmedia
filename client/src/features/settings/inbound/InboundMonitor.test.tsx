import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InboundMessage } from "@socmedia/shared";
import { renderWithProviders, mockFetch, installMockEventSource, MockEventSource } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { InboundMonitor } from "./InboundMonitor";

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "msg-1", channel: "twilio", providerMessageId: "SM123", senderId: "+15555550123", bindingId: "bind-1",
    orgId: "org1", userId: "u1", text: "Ribbon cutting today!", mediaCount: 1, hasAudio: false, status: "published",
    postId: "post-1", mediaIds: ["media-1"], links: [], reply: "Posted to Instagram", repliedBy: "system", error: null,
    timeline: [{ at: "2026-09-19T00:00:00Z", status: "received", message: "Message received" }],
    receivedAt: "2026-09-19T00:00:00Z", completedAt: "2026-09-19T00:00:05Z",
    ...overrides,
  };
}

describe("InboundMonitor", () => {
  beforeEach(() => {
    useAppStore.setState({ currentOrgId: "org1" });
  });

  it("renders messages from the endpoint", async () => {
    mockFetch({
      "GET /api/inbound/messages": () => [makeMessage()],
      "GET /api/inbound/bindings": () => [],
    });
    renderWithProviders(<InboundMonitor />);

    const row = await screen.findByTestId("inbound-message-row");
    expect(row).toHaveTextContent("Ribbon cutting today!");
    expect(row).toHaveTextContent("Published");
    expect(row).toHaveTextContent("0123"); // masked sender id keeps the last 4 digits
  });

  describe("live updates", () => {
    beforeEach(() => installMockEventSource());
    afterEach(() => { (globalThis as any).EventSource = undefined; });

    it("prepends a new message delivered over the stream", async () => {
      mockFetch({
        "GET /api/inbound/messages": () => [],
        "GET /api/inbound/bindings": () => [],
      });
      renderWithProviders(<InboundMonitor />);

      expect(screen.queryByTestId("inbound-message-row")).not.toBeInTheDocument();
      await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));

      const incoming = makeMessage({ id: "msg-2", text: "New photo from the field", status: "draft" });
      act(() => { MockEventSource.instances[MockEventSource.instances.length - 1]!.dispatch("inbound", { type: "message", message: incoming }); });

      const row = await screen.findByTestId("inbound-message-row");
      expect(row).toHaveTextContent("New photo from the field");
      expect(row).toHaveTextContent("Draft");
    });
  });

  it("confirms an awaiting-confirmation message", async () => {
    const { calls } = mockFetch({
      "GET /api/inbound/messages": () => [makeMessage({ status: "awaiting_confirmation" })],
      "GET /api/inbound/bindings": () => [],
      "POST /api/inbound/messages/:id/confirm": () => makeMessage({ status: "published" }),
    });
    const user = userEvent.setup();
    renderWithProviders(<InboundMonitor />);

    await user.click(await screen.findByTestId("inbound-message-row"));
    await user.click(await screen.findByTestId("confirm-message"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/inbound/messages/msg-1/confirm"))).toBe(true));
  });

  it("discards an awaiting-confirmation message", async () => {
    const { calls } = mockFetch({
      "GET /api/inbound/messages": () => [makeMessage({ status: "awaiting_confirmation" })],
      "GET /api/inbound/bindings": () => [],
      "POST /api/inbound/messages/:id/discard": () => makeMessage({ status: "ignored" }),
    });
    const user = userEvent.setup();
    renderWithProviders(<InboundMonitor />);

    await user.click(await screen.findByTestId("inbound-message-row"));
    await user.click(await screen.findByTestId("discard-message"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/inbound/messages/msg-1/discard"))).toBe(true));
  });
});
