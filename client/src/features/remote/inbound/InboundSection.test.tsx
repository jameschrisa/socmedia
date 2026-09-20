import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import type { InboundStatus } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { InboundSection } from "./InboundSection";

function makeStatus(overrides: Partial<InboundStatus> = {}): InboundStatus {
  return {
    channels: [
      { channel: "twilio", configured: true, enabled: true, state: "listening", webhookUrl: "https://app.example.com/api/inbound/twilio", lastEventAt: "2026-09-19T00:00:00Z", counts: { today: 3, published: 2, failed: 1, pending: 0 } },
      { channel: "telegram", configured: true, enabled: false, state: "error", detail: "Webhook not registered", webhookUrl: "https://app.example.com/api/inbound/telegram", counts: { today: 0, published: 0, failed: 0, pending: 0 } },
      { channel: "test", configured: false, enabled: false, state: "off", webhookUrl: "https://app.example.com/api/inbound/test", counts: { today: 0, published: 0, failed: 0, pending: 0 } },
    ],
    bindings: 2,
    transcription: { configured: false, provider: "none" },
    ...overrides,
  };
}

describe("InboundSection", () => {
  it("shows one status chip per channel reflecting InboundStatus", async () => {
    useAppStore.setState({ currentOrgId: "org1" });
    mockFetch({
      "GET /api/inbound/status": () => makeStatus(),
      "GET /api/inbound/channels": () => [],
      "GET /api/inbound/bindings": () => [],
      "GET /api/inbound/messages": () => [],
      "GET /api/inbound/transcription": () => ({ provider: "none", configured: false }),
      "GET /api/connections": () => [],
    });
    renderWithProviders(<InboundSection />);

    const twilioChip = await screen.findByTestId("inbound-chip-twilio");
    expect(twilioChip).toHaveTextContent("Twilio SMS/MMS/WhatsApp");
    expect(twilioChip).toHaveTextContent("Listening");
    expect(twilioChip).toHaveTextContent("3 today");
    expect(twilioChip.querySelector('[data-testid="inbound-edit-twilio"]')).toBeInTheDocument();

    const telegramChip = await screen.findByTestId("inbound-chip-telegram");
    expect(telegramChip).toHaveTextContent("Telegram");
    expect(telegramChip).toHaveTextContent("Error");

    const testChip = await screen.findByTestId("inbound-chip-test");
    expect(testChip).toHaveTextContent("Off");
    expect(testChip.querySelector('[data-testid="inbound-edit-test"]')).not.toBeInTheDocument();
  });
});
