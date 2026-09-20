import { afterEach, describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { LoginPage } from "./LoginPage";

const SIGNED_OUT = { authenticated: false, needsSetup: false, user: null };

describe("LoginPage", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("renders the sign-in heading and posts credentials to /api/auth/login", async () => {
    const { calls } = mockFetch({
      "GET /api/auth/me": () => SIGNED_OUT,
      "POST /api/auth/login": () => ({ authenticated: true, needsSetup: false, user: { id: "u1", email: "a@b.com", name: "Ada", role: "editor", orgIds: "*", active: true, mustChangePassword: false, createdAt: "", lastLoginAt: null } }),
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    expect(await screen.findByRole("heading", { name: /only authorized suprstars allowed/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "hunter22");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/auth/login"))).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ email: "a@b.com", password: "hunter22" });
  });

  it("shows the first-owner setup form when needsSetup is true", async () => {
    mockFetch({ "GET /api/auth/me": () => ({ authenticated: false, needsSetup: true, user: null }) });
    renderWithProviders(<LoginPage />);
    expect(await screen.findByRole("heading", { name: /create the first owner account/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows the server error message on a failed sign-in", async () => {
    mockFetch({
      "GET /api/auth/me": () => SIGNED_OUT,
      "POST /api/auth/login": () => new Response(JSON.stringify({ error: "Invalid email or password" }), { status: 401, headers: { "Content-Type": "application/json" } }),
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await screen.findByRole("heading", { name: /only authorized suprstars allowed/i });
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });

  it("shows a password-change step and posts to /api/auth/password when mustChangePassword is set", async () => {
    const { calls } = mockFetch({
      "GET /api/auth/me": () => ({ authenticated: true, needsSetup: false, user: { id: "u1", email: "a@b.com", name: "Ada", role: "editor", orgIds: "*", active: true, mustChangePassword: true, createdAt: "", lastLoginAt: null } }),
      "POST /api/auth/password": () => undefined,
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Current password"), "temp12345");
    await user.type(screen.getByLabelText("New password"), "brandnew123");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/auth/password"))).toBe(true));
    const post = calls.find((c) => c.method === "POST" && c.url.includes("/auth/password"))!;
    expect(post.body).toMatchObject({ currentPassword: "temp12345", newPassword: "brandnew123" });
  });

  it("requests a magic link and shows the check-your-email state, including the dev-mode link", async () => {
    mockFetch({
      "GET /api/auth/me": () => ({ ...SIGNED_OUT, providers: { password: true, magicLink: true, google: false } }),
      "POST /api/auth/magic/request": () => ({ ok: true, delivered: "log", link: "http://localhost/api/auth/magic/verify?token=abc123" }),
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await screen.findByRole("heading", { name: /only authorized suprstars allowed/i });
    await user.type(screen.getByLabelText("Email"), "ada@acme.com");
    await user.click(screen.getByRole("button", { name: /email me a sign-in link/i }));

    expect(await screen.findByText(/we sent a sign-in link to ada@acme\.com/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "http://localhost/api/auth/magic/verify?token=abc123" })).toHaveAttribute(
      "href",
      "http://localhost/api/auth/magic/verify?token=abc123",
    );
  });

  it("shows the Google button only when the provider is enabled", async () => {
    mockFetch({ "GET /api/auth/me": () => ({ ...SIGNED_OUT, providers: { password: true, magicLink: false, google: true } }) });
    renderWithProviders(<LoginPage />);
    expect(await screen.findByRole("link", { name: /continue with google/i })).toHaveAttribute("href", "/api/auth/google/start");
  });

  it("hides the Google button when the provider is disabled", async () => {
    mockFetch({ "GET /api/auth/me": () => ({ ...SIGNED_OUT, providers: { password: true, magicLink: false, google: false } }) });
    renderWithProviders(<LoginPage />);
    await screen.findByRole("heading", { name: /only authorized suprstars allowed/i });
    expect(screen.queryByRole("link", { name: /continue with google/i })).not.toBeInTheDocument();
  });

  it("reveals the password form via 'Use a password instead', reusing the typed email, within one click", async () => {
    mockFetch({ "GET /api/auth/me": () => ({ ...SIGNED_OUT, providers: { password: true, magicLink: true, google: false } }) });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await screen.findByRole("heading", { name: /only authorized suprstars allowed/i });
    await user.type(screen.getByLabelText("Email"), "ada@acme.com");
    await user.click(screen.getByRole("button", { name: /use a password instead/i }));

    expect(screen.getByLabelText("Email")).toHaveValue("ada@acme.com");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows the matching notice for a failed sign-in redirect and cleans the URL", async () => {
    window.history.pushState({}, "", "/?auth=error&reason=expired");
    mockFetch({ "GET /api/auth/me": () => SIGNED_OUT });
    renderWithProviders(<LoginPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("That sign-in link has expired. Request a new one.");
    expect(window.location.search).toBe("");
  });

  it("links to request access without naming the allowed domains", async () => {
    mockFetch({ "GET /api/auth/me": () => ({ ...SIGNED_OUT, allowedDomains: ["acme.com", "beta.io"] }) });
    renderWithProviders(<LoginPage />);

    expect(await screen.findByRole("link", { name: /request access/i })).toHaveAttribute("href", "/request-access");
    expect(screen.queryByText(/Sign-in is limited to/)).not.toBeInTheDocument();
  });

  function mockMatchMedia(reduceMotion: boolean) {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduceMotion : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    return () => { window.matchMedia = original; };
  }

  it("shows the background video with a poster when motion is allowed", async () => {
    const restore = mockMatchMedia(false);
    mockFetch({ "GET /api/auth/me": () => SIGNED_OUT });
    renderWithProviders(<LoginPage />);
    await screen.findByRole("heading", { name: /only authorized suprstars allowed/i });

    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    expect(video).toHaveAttribute("poster", "/media/login-bg.jpg");
    expect(video?.querySelector("source")).toHaveAttribute("src", "/media/login-bg.mp4");
    restore();
  });

  it("shows only the poster image, no video, under prefers-reduced-motion", async () => {
    const restore = mockMatchMedia(true);
    mockFetch({ "GET /api/auth/me": () => SIGNED_OUT });
    renderWithProviders(<LoginPage />);
    await screen.findByRole("heading", { name: /only authorized suprstars allowed/i });

    expect(document.querySelector("video")).toBeNull();
    const poster = document.querySelector("img[alt='']");
    expect(poster).toHaveAttribute("src", "/media/login-bg.jpg");
    restore();
  });
});
