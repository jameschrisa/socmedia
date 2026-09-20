import crypto from "node:crypto";
import { config } from "../config";

/** The httpOnly cookie carrying the OAuth `state` value (with the nonce appended) between /entra/start and /entra/callback. */
export const ENTRA_STATE_COOKIE = "suprstar_entra_state";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLOCK_SKEW_SECONDS = 120;

export type FetchLike = typeof fetch;

// Module-level override so tests can stub Entra's token/JWKS endpoints without a real network call.
let fetchImpl: FetchLike = fetch;

export function setEntraFetch(impl: FetchLike): void {
  fetchImpl = impl;
}

export function resetEntraFetch(): void {
  fetchImpl = fetch;
}

export function entraConfigured(): boolean {
  return !!config.entraClientId && !!config.entraClientSecret;
}

/** The configured tenant, defaulting to "organizations" (any Entra org can sign in). */
export function entraTenant(): string {
  return config.entraTenantId || "organizations";
}

export function entraRedirectUri(): string {
  return `${config.clientUrl}/api/auth/entra/callback`;
}

function tenantEndpoint(segment: string): string {
  return `https://login.microsoftonline.com/${entraTenant()}/${segment}`;
}

export function entraAuthorizeEndpoint(): string {
  return tenantEndpoint("oauth2/v2.0/authorize");
}

export function entraTokenEndpoint(): string {
  return tenantEndpoint("oauth2/v2.0/token");
}

export function entraJwksEndpoint(): string {
  return tenantEndpoint("discovery/v2.0/keys");
}

export function entraStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: config.nodeEnv === "production",
    maxAge: STATE_TTL_MS,
  };
}

/**
 * Generates the `state` cookie/query value and the `nonce` sent to Entra. The nonce rides inside
 * the state string (`<random>.<nonce>`) so the callback can recover it from the same cookie it
 * already checks for CSRF, without a second short-lived cookie.
 */
export function generateEntraState(): { state: string; nonce: string } {
  const random = crypto.randomBytes(24).toString("base64url");
  const nonce = crypto.randomBytes(24).toString("base64url");
  return { state: `${random}.${nonce}`, nonce };
}

/** Recovers the nonce embedded in a `state` value produced by `generateEntraState`. */
export function nonceFromState(state: string): string {
  const idx = state.lastIndexOf(".");
  return idx === -1 ? "" : state.slice(idx + 1);
}

export function entraAuthorizeUrl(state: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: config.entraClientId,
    response_type: "code",
    redirect_uri: entraRedirectUri(),
    response_mode: "query",
    // Minimal scope: we only need an id_token to identify the user, no Graph calls or refresh tokens.
    scope: "openid profile email",
    state,
    nonce,
  });
  return `${entraAuthorizeEndpoint()}?${params.toString()}`;
}

interface EntraTokenResponse {
  access_token?: string;
  id_token?: string;
  [key: string]: unknown;
}

/** Exchanges an authorization `code` for tokens (the `id_token` is what we actually need). */
export async function exchangeEntraCode(code: string): Promise<EntraTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.entraClientId,
    client_secret: config.entraClientSecret,
    code,
    redirect_uri: entraRedirectUri(),
    grant_type: "authorization_code",
    scope: "openid profile email",
  });
  const res = await fetchImpl(entraTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Entra token exchange failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as EntraTokenResponse;
}

interface JsonWebKeyLike {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

interface Jwks {
  keys: JsonWebKeyLike[];
}

interface JwksCacheEntry {
  fetchedAt: number;
  jwks: Jwks;
}

// Cached per tenant for an hour so a busy sign-in flow doesn't hammer the discovery endpoint.
const jwksCache = new Map<string, JwksCacheEntry>();

export function resetEntraJwksCache(): void {
  jwksCache.clear();
}

async function fetchJwks(tenant: string): Promise<Jwks> {
  const cached = jwksCache.get(tenant);
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) return cached.jwks;
  const res = await fetchImpl(entraJwksEndpoint());
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Entra JWKS fetch failed: ${res.status} ${detail}`);
  }
  const jwks = (await res.json()) as Jwks;
  jwksCache.set(tenant, { fetchedAt: Date.now(), jwks });
  return jwks;
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

interface EntraIdTokenClaims {
  aud?: string;
  iss?: string;
  tid?: string;
  oid?: string;
  sub?: string;
  exp?: number;
  nonce?: string;
  email?: string;
  preferred_username?: string;
  upn?: string;
  name?: string;
  [key: string]: unknown;
}

export interface EntraIdentity {
  email: string;
  name?: string;
  /** `oid` (stable per user per tenant), falling back to `sub`. */
  subject: string;
}

/**
 * Verifies an Entra id_token's RS256 signature against the tenant's published JWKS, then checks
 * `aud`, `iss`, `tid` (when a specific tenant is configured), `exp` and `nonce` before extracting
 * the identity. Throws with a specific message on any failure; never trusts an unverified token.
 */
export async function verifyEntraIdToken(idToken: string, expectedNonce: string): Promise<EntraIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed id_token");
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  let claims: EntraIdTokenClaims;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    claims = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new Error("id_token header/payload is not valid JSON");
  }

  if (header.alg !== "RS256") throw new Error(`Unsupported id_token algorithm: ${header.alg}`);
  if (!header.kid) throw new Error("id_token is missing a kid");

  const tenant = entraTenant();
  const jwks = await fetchJwks(tenant);
  const key = jwks.keys.find((k) => k.kid === header.kid);
  if (!key) throw new Error(`No matching JWKS key for kid ${header.kid}`);

  const publicKey = crypto.createPublicKey({ key: key as unknown as crypto.JsonWebKeyInput["key"], format: "jwk" });
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  const signatureValid = verifier.verify(publicKey, base64UrlDecode(signatureB64));
  if (!signatureValid) throw new Error("id_token signature verification failed");

  if (claims.aud !== config.entraClientId) throw new Error("id_token aud does not match our client id");
  if (!claims.iss || !claims.iss.startsWith("https://login.microsoftonline.com/")) {
    throw new Error("id_token iss is not a Microsoft identity platform issuer");
  }
  const specificTenant = config.entraTenantId && config.entraTenantId !== "organizations" ? config.entraTenantId : "";
  if (specificTenant && claims.tid !== specificTenant) throw new Error("id_token tid does not match the configured tenant");

  const nowSeconds = Date.now() / 1000;
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) throw new Error("id_token has expired");

  if (!expectedNonce || claims.nonce !== expectedNonce) throw new Error("id_token nonce does not match");

  const rawEmail = claims.email ?? claims.preferred_username ?? claims.upn;
  if (!rawEmail || !rawEmail.includes("@")) throw new Error("id_token has no usable email claim");
  const subject = claims.oid ?? claims.sub;
  if (!subject) throw new Error("id_token has no subject (oid/sub)");

  return {
    email: rawEmail.trim().toLowerCase(),
    name: typeof claims.name === "string" ? claims.name : undefined,
    subject,
  };
}
