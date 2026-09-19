import crypto from "node:crypto";
import { config } from "../config";

/** The httpOnly cookie carrying the OAuth `state` value between /google/start and /google/callback. */
export const GOOGLE_STATE_COOKIE = "suprstar_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type FetchLike = typeof fetch;

// Module-level override so tests can stub Google's token/userinfo endpoints without a real network call.
let fetchImpl: FetchLike = fetch;

export function setGoogleFetch(impl: FetchLike): void {
  fetchImpl = impl;
}

export function resetGoogleFetch(): void {
  fetchImpl = fetch;
}

export function googleConfigured(): boolean {
  return !!config.googleClientId && !!config.googleClientSecret;
}

export function googleRedirectUri(): string {
  return `${config.clientUrl}/api/auth/google/callback`;
}

export function generateGoogleState(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function googleStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: config.nodeEnv === "production",
    maxAge: STATE_TTL_MS,
  };
}

export function googleAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  id_token?: string;
  [key: string]: unknown;
}

/** Exchanges an authorization `code` for an access token. */
export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  [key: string]: unknown;
}

/** Fetches the signed-in Google account's profile using a valid access token. */
export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google userinfo failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as GoogleUserInfo;
}
