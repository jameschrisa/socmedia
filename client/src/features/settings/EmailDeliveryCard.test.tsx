import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { EmailDeliveryCard } from "./EmailDeliveryCard";

const ME = () => ({
  authenticated: true,
  needsSetup: false,
  user: { id: "u1", email: "ada@f3insights.com", name: "Ada", role: "owner", orgIds: "*", active: true, mustChangePassword: false, createdAt: "", lastLoginAt: null },
});

describe("EmailDeliveryCard", () => {
  it("shows Resend as the provider and the from address when configured", async () => {
    mockFetch({
      "GET /api/auth/me": ME,
      "GET /api/settings/mail": () => ({
        provider: "resend", configured: true, from: "suprstar@f3insights.com", canSendMagicLinks: true,
        lastTestAt: null, lastTestOk: null, lastTestError: null,
      }),
    });
    renderWithProviders(<EmailDeliveryCard />);

    expect(await screen.findByText("Resend")).toBeInTheDocument();
    expect(screen.getByText("suprstar@f3insights.com")).toBeInTheDocument();
    expect(screen.getByText(/magic sign-in links can be delivered/i)).toBeInTheDocument();
  });

  it("shows SMTP as the provider", async () => {
    mockFetch({
      "GET /api/auth/me": ME,
      "GET /api/settings/mail": () => ({
        provider: "smtp", configured: true, from: "notify@f3insights.com", canSendMagicLinks: true,
        lastTestAt: null, lastTestOk: null, lastTestError: null,
      }),
    });
    renderWithProviders(<EmailDeliveryCard />);
    expect(await screen.findByText("SMTP")).toBeInTheDocument();
  });

  it("shows 'Not configured' for the log provider and warns that magic links can't be delivered", async () => {
    mockFetch({
      "GET /api/auth/me": ME,
      "GET /api/settings/mail": () => ({
        provider: "log", configured: false, from: null, canSendMagicLinks: false,
        lastTestAt: null, lastTestOk: null, lastTestError: null,
      }),
    });
    renderWithProviders(<EmailDeliveryCard />);

    expect(await screen.findByText("Not configured")).toBeInTheDocument();
    expect(screen.getByText("not set")).toBeInTheDocument();
    expect(screen.getByText(/magic links can't be delivered yet/i)).toBeInTheDocument();
    expect(screen.getByText("MAIL_PROVIDER")).toBeInTheDocument();
  });

  it("defaults the test-email field to the signed-in user's address, sends a test and shows success with the time", async () => {
    const { calls } = mockFetch({
      "GET /api/auth/me": ME,
      "GET /api/settings/mail": () => ({
        provider: "resend", configured: true, from: "suprstar@f3insights.com", canSendMagicLinks: true,
        lastTestAt: null, lastTestOk: null, lastTestError: null,
      }),
      "POST /api/settings/mail/test": () => ({
        provider: "resend", configured: true, from: "suprstar@f3insights.com", canSendMagicLinks: true,
        lastTestAt: "2026-09-20T12:00:00.000Z", lastTestOk: true, lastTestError: null,
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<EmailDeliveryCard />);

    const input = await screen.findByLabelText("Send a test email");
    expect(input).toHaveValue("ada@f3insights.com");

    await user.click(screen.getByRole("button", { name: "Send a test email" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/settings/mail/test"))).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ to: "ada@f3insights.com" });

    expect(await screen.findByTestId("mail-test-success")).toHaveTextContent("Test email sent at");
  });

  it("shows that a log-provider test went to the activity log, not a mailbox", async () => {
    mockFetch({
      "GET /api/auth/me": ME,
      "GET /api/settings/mail": () => ({
        provider: "log", configured: false, from: null, canSendMagicLinks: false,
        lastTestAt: null, lastTestOk: null, lastTestError: null,
      }),
      "POST /api/settings/mail/test": () => ({
        provider: "log", configured: false, from: null, canSendMagicLinks: false,
        lastTestAt: "2026-09-20T12:00:00.000Z", lastTestOk: true, lastTestError: null,
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<EmailDeliveryCard />);

    await screen.findByLabelText("Send a test email");
    await user.click(screen.getByRole("button", { name: "Send a test email" }));

    expect(await screen.findByTestId("mail-test-success")).toHaveTextContent(/written to the activity log/i);
  });

  it("shows the delivery failure with lastTestError", async () => {
    mockFetch({
      "GET /api/auth/me": ME,
      "GET /api/settings/mail": () => ({
        provider: "smtp", configured: true, from: "notify@f3insights.com", canSendMagicLinks: true,
        lastTestAt: null, lastTestOk: null, lastTestError: null,
      }),
      "POST /api/settings/mail/test": () => ({
        provider: "smtp", configured: true, from: "notify@f3insights.com", canSendMagicLinks: true,
        lastTestAt: "2026-09-20T12:00:00.000Z", lastTestOk: false, lastTestError: "Connection refused by smtp.example.com",
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<EmailDeliveryCard />);

    await screen.findByLabelText("Send a test email");
    await user.click(screen.getByRole("button", { name: "Send a test email" }));

    expect(await screen.findByTestId("mail-test-failure")).toHaveTextContent("Connection refused by smtp.example.com");
  });

  it("shows a rate-limit notice on a 429", async () => {
    mockFetch({
      "GET /api/auth/me": ME,
      "GET /api/settings/mail": () => ({
        provider: "resend", configured: true, from: "suprstar@f3insights.com", canSendMagicLinks: true,
        lastTestAt: null, lastTestOk: null, lastTestError: null,
      }),
      "POST /api/settings/mail/test": () =>
        new Response(JSON.stringify({ error: "Too many test emails" }), { status: 429, headers: { "Content-Type": "application/json" } }),
    });
    const user = userEvent.setup();
    renderWithProviders(<EmailDeliveryCard />);

    await screen.findByLabelText("Send a test email");
    await user.click(screen.getByRole("button", { name: "Send a test email" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too many test emails/i);
  });
});
