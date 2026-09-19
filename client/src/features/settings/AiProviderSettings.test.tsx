import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { AiSettings } from "@socmedia/shared";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { AiProviderSettings } from "./AiProviderSettings";

const base: AiSettings = {
  provider: "mock",
  anthropic: { apiKey: "", model: "claude-opus-5" },
  moonshot: { apiKey: "", model: "kimi-k3", baseUrl: "https://api.moonshot.ai/v1" },
  anthropicFromEnv: false,
  updatedAt: null,
};

describe("AiProviderSettings", () => {
  it("shows both providers with the saved mode and models", async () => {
    mockFetch({ "GET /api/settings/ai": () => ({ ...base, provider: "anthropic", anthropic: { apiKey: "••••abcd", model: "claude-sonnet-5" } }) });
    renderWithProviders(<AiProviderSettings />);
    await screen.findByTestId("ai-provider-settings");
    expect(screen.getByRole("tab", { name: "Claude (Anthropic)" })).toHaveAttribute("aria-selected", "true");
    expect((screen.getByLabelText("API key", { selector: "#anthropic-key" }) as HTMLInputElement).value).toBe("••••abcd");
    expect((screen.getByLabelText("Model", { selector: "#anthropic-model" }) as HTMLSelectElement).value).toBe("claude-sonnet-5");
    expect(screen.getByText("Saved. Paste a new key to replace it, or clear to remove.")).toBeInTheDocument();
  });

  it("switches to Kimi, enters a key and model, and saves", async () => {
    let saved: any = null;
    const { calls } = mockFetch({
      "GET /api/settings/ai": () => base,
      "PUT /api/settings/ai": (init) => {
        saved = JSON.parse(init!.body as string);
        return { ...base, provider: "moonshot", moonshot: { apiKey: "••••9999", model: "kimi-k2.6", baseUrl: "https://api.moonshot.ai/v1" }, updatedAt: "2026-09-18T00:00:00Z" };
      },
      "GET /api/health": () => ({ ok: true, ai: { configured: true, provider: "moonshot", model: "kimi-k2.6" } }),
    });
    renderWithProviders(<AiProviderSettings />);
    await screen.findByTestId("ai-provider-settings");
    fireEvent.click(screen.getByRole("tab", { name: "Kimi (Moonshot)" }));
    fireEvent.change(screen.getByLabelText("API key", { selector: "#moonshot-key" }), { target: { value: "sk-moon-99999999" } });
    fireEvent.change(screen.getByLabelText("Model", { selector: "#moonshot-model" }), { target: { value: "kimi-k2.6" } });
    const save = screen.getByTestId("ai-settings-save");
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved.provider).toBe("moonshot");
    expect(saved.moonshot).toMatchObject({ apiKey: "sk-moon-99999999", model: "kimi-k2.6" });
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
    await waitFor(() => expect((screen.getByLabelText("API key", { selector: "#moonshot-key" }) as HTMLInputElement).value).toBe("••••9999"));
  });

  it("runs a connection test and shows the result", async () => {
    mockFetch({
      "GET /api/settings/ai": () => ({ ...base, provider: "anthropic", anthropic: { apiKey: "••••abcd", model: "claude-opus-5" } }),
      "POST /api/settings/ai/test": () => ({ ok: true, provider: "anthropic", model: "claude-opus-5", latencyMs: 210, message: "Authenticated. Model available: Claude Opus 5." }),
      "GET /api/health": () => ({ ok: true, ai: { configured: true, provider: "anthropic", model: "claude-opus-5" } }),
    });
    renderWithProviders(<AiProviderSettings />);
    await screen.findByTestId("ai-provider-settings");
    const anthropicCard = screen.getByTestId("provider-anthropic");
    fireEvent.click(anthropicCard.querySelector("button.bg-brand-50, button[class*='bg-brand-50']") ?? anthropicCard.querySelectorAll("button")[anthropicCard.querySelectorAll("button").length - 1]!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Authenticated/));
  });

  it("supports a custom model id", async () => {
    mockFetch({ "GET /api/settings/ai": () => base });
    renderWithProviders(<AiProviderSettings />);
    await screen.findByTestId("ai-provider-settings");
    fireEvent.change(screen.getByLabelText("Model", { selector: "#moonshot-model" }), { target: { value: "__custom" } });
    const custom = screen.getByLabelText("Kimi custom model id");
    fireEvent.change(custom, { target: { value: "kimi-k2.7-code" } });
    expect((custom as HTMLInputElement).value).toBe("kimi-k2.7-code");
  });
});
