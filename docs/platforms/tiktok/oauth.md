---
platform: tiktok
topic: oauth
sources:
  - https://developers.tiktok.com/doc/login-kit-web
  - https://developers.tiktok.com/doc/oauth-user-access-token-management
  - https://developers.tiktok.com/doc/oauth-error-handling
  - https://developers.tiktok.com/doc/tiktok-api-scopes
  - https://developers.tiktok.com/doc/scopes-overview
  - https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
  - https://developers.tiktok.com/doc/tiktok-api-v2-error-handling
  - https://developers.tiktok.com/doc/getting-started-faq
  - https://developers.tiktok.com/doc/legacy-user-access-guide
fetched: 2026-09-19
---

# TikTok: OAuth (Login Kit web) as used by suprstar

## Flow summary

Source: https://developers.tiktok.com/doc/login-kit-web and suprstar `server/src/routes/connections.ts`, `server/src/platforms/tiktok.ts`

1. User clicks **Connect** on the TikTok Social Profile. suprstar `POST /api/connections/:id/connect` builds the authorize URL (below) with `state` = base64url JSON `{"connectionId": "<id>"}` and returns it; the browser navigates there.
2. TikTok shows the consent screen for the requested scopes. The user can approve all, a subset, or deny.
3. TikTok redirects to the registered `redirect_uri` with `code`, `scopes`, `state` (or `error`, `error_description`).
4. suprstar's public callback `GET /api/connections/oauth/callback` decodes `state`, calls `exchangeCode` (`POST /v2/oauth/token/`, `grant_type=authorization_code`), then `fetchProfile` (`GET /v2/user/info/`), stores `accessToken`, `refreshToken`, `tokenExpiresAt`, granted `scopes`, `open_id`/`union_id` in `credentials.extra`, sets status `connected`, and redirects to `/connections?connected=tiktok`.
5. Any failure in step 4 redirects to `/connections?error=<message>`; the message is the raw `error_description` (or `error`) from TikTok, or suprstar's own strings `Missing code or state parameter` / `Unknown connection`.

suprstar does not use PKCE for TikTok (web flows do not require it; `code_verifier` is "Required for mobile and desktop app only"). In **Mode: Sandbox** the connect call skips TikTok entirely and fabricates tokens (`sb_access_...`).

## Step 1: authorization request

Source: https://developers.tiktok.com/doc/login-kit-web

Endpoint: `GET https://www.tiktok.com/v2/auth/authorize/`

| Parameter | Required | suprstar sends | Official note |
|---|---|---|---|
| `client_key` | Yes | card-back **Client ID** | "The unique identification key provisioned to the partner" (TikTok calls it a key, not `client_id`) |
| `response_type` | Yes | `code` | Must always be `code` |
| `scope` | Yes | card-back scope checkboxes joined with `,` (defaults to the five spec scopes) | "A comma (,) separated string of authorization scope(s)" |
| `redirect_uri` | Yes | card-back **Redirect URI** | "must be absolute and begin with `https`"; must match a registered URI |
| `state` | Yes | base64url `{"connectionId": ...}` | "Used to maintain the state of your request and callback"; CSRF protection |
| `disable_auto_auth` | No | not sent | Integer 0/1; controls whether the authorization page is shown when the user already authorized |

Redirect URI registration rules (Login Kit product settings in the TT4D app):

- "Maximum 10 URIs per app", "Each under 512 characters".
- "Must use HTTPS with no query parameters or fragments". Example given: `https://dev.example.com/auth/callback/` is valid, `dev.example.com/auth/callback/` is not.
- The value sent in `redirect_uri` must be byte-identical to a registered one, including trailing slash. suprstar's suggested value is `<app origin>/api/connections/oauth/callback` (no trailing slash); register exactly that string.
- Because HTTPS is mandatory, `http://localhost:4000/...` (the seeded default) cannot be registered. Local development needs an HTTPS tunnel whose hostname is registered, or suprstar's Sandbox mode.

## Step 2: callback parameters

Source: https://developers.tiktok.com/doc/login-kit-web

TikTok appends to `redirect_uri`:

| Parameter | Meaning |
|---|---|
| `code` | Authorization code, exchanged once for tokens |
| `scopes` | "A comma-separated (,) string of authorization scope(s), which the user has granted" (may be a subset of what was requested) |
| `state` | Echo of the request `state` |
| `error` | Present on failure (for example `access_denied`) |
| `error_description` | "Human-readable error explanation" |

suprstar ignores `scopes` from the redirect and instead stores the `scope` string returned by the token endpoint. If the user unticked `video.publish`, the connection still shows as connected; publishing then fails with `scope_not_authorized` (see `errors.md`).

## Step 3: token exchange

Source: https://developers.tiktok.com/doc/oauth-user-access-token-management

`POST https://open.tiktokapis.com/v2/oauth/token/` with `Content-Type: application/x-www-form-urlencoded` (suprstar also sends `Cache-Control: no-cache`).

Body (authorization code grant):

| Field | suprstar value |
|---|---|
| `client_key` | card-back Client ID |
| `client_secret` | card-back Client secret |
| `code` | from callback |
| `grant_type` | `authorization_code` |
| `redirect_uri` | card-back Redirect URI; "Its value must be the same as the `redirect_uri` used for requesting code" |
| `code_verifier` | not sent ("Required for mobile and desktop app only") |

Response fields:

| Field | Type | Official note |
|---|---|---|
| `access_token` | string | Bearer token for API calls |
| `expires_in` | int64 | "The expiration of `access_token` in seconds. It is valid for 24 hours after initial issuance" |
| `refresh_token` | string | "valid for 365 days after the initial issuance" |
| `refresh_expires_in` | int64 | "The expiration for `refresh_token` in seconds" |
| `open_id` | string | "The TikTok user's unique identifier" |
| `scope` | string | "A comma-separated list (,) of the scopes the user has agreed to authorize" |
| `token_type` | string | Always `Bearer` |

suprstar maps `access_token` -> `credentials.accessToken`, `refresh_token` -> `credentials.refreshToken`, `expires_in` -> `credentials.tokenExpiresAt` (now + seconds), `scope` -> `credentials.scopes`. It does not store `refresh_expires_in`, so the 365-day refresh expiry is not shown in the UI.

## Step 4: refreshing the access token

Source: https://developers.tiktok.com/doc/oauth-user-access-token-management

Same endpoint, body: `client_key`, `client_secret`, `grant_type=refresh_token`, `refresh_token`. Response has the same shape as above.

Rotation rule: "The returned `refresh_token` may be different than the one passed in the payload. You must use the newly-returned token if the value is different than the previous one." suprstar handles this (`refreshToken: data.refresh_token ?? conn.credentials.refreshToken`).

When suprstar refreshes: only when the user presses **Refresh token** on the card back (`POST /api/connections/:id/refresh`). There is no automatic refresh before a publish, connection test, or scheduled job. Because TikTok access tokens live 24 hours, a live TikTok connection needs a refresh at least daily or every publish after that returns `access_token_invalid`. See `troubleshooting.md` "token expired every day".

Revocation: `POST https://open.tiktokapis.com/v2/oauth/revoke/` with `client_key`, `client_secret`, `token` (access token); "Response: Empty on success". suprstar's **Disconnect** only clears tokens locally; it does not call revoke.

## Scopes suprstar requests and what each unlocks

Source: https://developers.tiktok.com/doc/tiktok-api-scopes, https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info

| Scope | Unlocks in suprstar | Symptom if missing / not granted |
|---|---|---|
| `user.info.basic` | `open_id`, `union_id`, `avatar_url`, `display_name` on `/v2/user/info/`; connection test | Connection test fails with `scope_not_authorized` (HTTP 401) or `scope_permission_missed` (HTTP 400) |
| `user.info.stats` | `follower_count` (also `following_count`, `likes_count`, `video_count`) | `/v2/user/info/` returns HTTP 400 `scope_permission_missed`: "Access token is invalid, some fields need additional scopes." because suprstar always requests `follower_count` |
| `video.publish` | Direct Post video and photo (`.../video/init/`, `.../content/init/`), Get Post Status | Publish fails HTTP 401 `scope_not_authorized`: "The access_token does not bear user's grant on `video.publish` scope." |
| `video.upload` | Upload-to-inbox endpoint, Get Post Status; also accepted for photo `content/init` | Not needed for current suprstar flows; harmless to keep |
| `video.list` | `/v2/video/list/`, `/v2/video/query/` (per-video counters) | Not used yet (`fetchMetrics` returns `[]`) |

Not requested: `user.info.profile` (`username`, `profile_deep_link`, `is_verified`, `bio_description`). Without it suprstar sets `handle` to `@<display_name>`, which is not necessarily the real @username; the `externalUrl` it builds for a published post (`https://www.tiktok.com/@<display_name>`) may therefore 404.

Scopes must be approved on the app before they can be requested. Requesting a scope the app is not approved for surfaces as `invalid_scope` / `unauthorized_client` at the authorize step (see errors).

## Common auth errors

Source: https://developers.tiktok.com/doc/oauth-error-handling (exact strings), https://developers.tiktok.com/doc/oauth-user-access-token-management (examples)

Token endpoint error body: `{"error": "<code>", "error_description": "<text>", "log_id": "<id>"}`. suprstar surfaces `error_description || error` as the connection error message. Keep the `log_id` when contacting TikTok support.

| `error` | Official description | Typical cause in suprstar | Fix |
|---|---|---|---|
| `invalid_request` | "The request misses a required parameter or is otherwise malformed." Documented examples: "Redirect_uri is not matched with the uri when requesting code." and "The request parameters are malformed." | Card-back Redirect URI differs from the one registered in Login Kit (trailing slash, http vs https, different host) or was edited between authorize and callback | Make Redirect URI identical to the registered value; reconnect |
| `invalid_client` | "Client authentication failed (for example, unknown client, no client authentication included, or unsupported authentication method)." | Client ID/secret mismatch, secret copied with whitespace, or production credentials used against a Sandbox app (or vice versa) | Re-copy `client_key`/`client_secret` from the same TT4D app/sandbox; save; reconnect |
| `invalid_grant` | "The provided authorization grant (for example, authorization code or resource owner credentials) or refresh token is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client." | Code reused (callback hit twice), code expired, refresh token older than 365 days, user revoked the app in TikTok settings, or refresh token from a different client | Reconnect (new authorization). For refresh failures the official guidance is to re-trigger the login flow |
| `invalid_scope` | "The requested scope is invalid, unknown, or malformed." | A scope ticked on the card back is not added/approved on the TT4D app, or a typo | Untick scopes not approved for the app, or add them in the TT4D app scopes section |
| `unauthorized_client` | "The client is not authorized to request an authorization code using this method." | Login Kit product not added, or web platform / redirect URI not configured for this app | Add Login Kit, configure the web platform and redirect URI |
| `access_denied` | "The resource owner or authorization server denied the request." | User cancelled on the consent screen, or account is ineligible (e.g. region, age) | Retry connect; ensure the TikTok account is eligible and, for a sandbox client, listed as a target user |
| `unsupported_grant_type` | "The authorization grant type is not supported by the authorization server." | Wrong `grant_type` value (not possible with the shipped adapter) | n/a |
| `unsupported_response_type` | "The authorization server does not support obtaining an authorization code using this method." | `response_type` other than `code` | n/a |
| `server_error` | "Other internal server errors." | TikTok side | Retry with backoff |
| `temporarily_unavailable` | "Service is temporarily unavailable." | TikTok side | Retry with backoff |

API-call auth errors after connect (`error.code` in the JSON body; see `errors.md` for the full table):

- `access_token_invalid` (HTTP 401): "The access token is invalid or not found in the request." The 24-hour access token expired, was revoked, or the stored value is empty. Fix: **Refresh token** on the card back; if that returns `invalid_grant`, reconnect.
- `scope_not_authorized` (HTTP 401): "The user did not authorize the scope required for completing this request." Reconnect and accept all scopes.
- `scope_permission_missed` (HTTP 400): "Access token is invalid, some fields need additional scopes." Requested a field whose scope was not granted (`follower_count` without `user.info.stats`).

Unverified app / unaudited client is not an OAuth error on TikTok: login succeeds, but posting is restricted to `SELF_ONLY` and 5 users per day (see `overview.md`).

## Legacy endpoint (do not use)

Source: https://developers.tiktok.com/doc/legacy-user-access-guide

The OAuth v1 endpoint `https://open-api.tiktok.com/oauth/access_token/` is deprecated ("Legacy user access tokens using our OAuth v1 API are deprecated"). Legacy numeric errors such as `10002` "Parameter error" indicate code still pointing at v1. suprstar uses only `/v2/oauth/token/`.

## Date-sensitive items

- Access token 24 h, refresh token 365 d (verified 2026-09-19).
- Redirect URI limits: 10 per app, 512 chars, HTTPS only.
- `code_verifier` is optional for web; if TikTok makes PKCE mandatory for web clients the adapter must add `code_challenge`/`code_challenge_method` to the authorize URL.
