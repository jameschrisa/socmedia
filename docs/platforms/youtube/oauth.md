---
platform: youtube
topic: oauth
sources:
  - https://developers.google.com/identity/protocols/oauth2/web-server
  - https://developers.google.com/identity/protocols/oauth2
  - https://developers.google.com/youtube/v3/guides/auth/installed-apps
  - https://developers.google.com/youtube/reporting/guides/authorization
  - https://developers.google.com/youtube/v3/guides/authentication
  - https://developers.google.com/youtube/v3/docs/channels/list
  - https://developers.google.com/youtube/v3/docs/errors
  - https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
fetched: 2026-09-19
---

# YouTube: OAuth 2.0 (Google) as used by suprstar

## Flow summary (what suprstar does)

Source: https://developers.google.com/identity/protocols/oauth2/web-server ; app code `server/src/platforms/youtube.ts`, `server/src/routes/connections.ts`

1. User clicks **Connect** on the YouTube Social Profile. `POST /api/connections/:id/connect` builds the authorize URL and returns it; the browser navigates there. In `sandbox` mode this step fabricates tokens instead and never leaves the app.
2. Google shows the consent screen; on approval it redirects to `redirect_uri` with `code` and `state`.
3. `GET /api/connections/oauth/callback` decodes `state` (base64url JSON `{connectionId}`), exchanges `code` at the token endpoint, then calls `channels.list?mine=true` to fill display name, handle (`@customUrl`), avatar, subscriber count and `extra.channelId`, and sets status `connected`.
4. On any failure the callback redirects to `/connections?error=<message>` where `<message>` is Google's `error_description` or `error` string, or the app's own text.

suprstar does **not** use PKCE (`code_verifier`/`code_challenge`) and does **not** validate `state` against a stored nonce; `state` only carries the connection id.

## Step 1: authorization request

Source: https://developers.google.com/identity/protocols/oauth2/web-server

Endpoint: `https://accounts.google.com/o/oauth2/v2/auth` (HTTPS only).

Parameters suprstar sends:

| Parameter | Value in suprstar | Notes from Google |
|---|---|---|
| `client_id` | card-back **Client ID** | Required |
| `redirect_uri` | card-back **Redirect URI** | Required; "Must exactly match a registered URI" |
| `response_type` | `code` | Required for web server apps |
| `access_type` | `offline` | Needed to receive a `refresh_token` |
| `prompt` | `consent` | Forces the consent screen so a refresh token is issued on every connect (Google otherwise only returns one on the first grant) |
| `scope` | card-back **Scopes**, space-joined (defaults below) | Required; space-delimited |
| `state` | base64url `{"connectionId":"..."}` | Google recommends a random CSRF value; suprstar uses it as a routing key only |

Not sent: `include_granted_scopes`, `login_hint`, `enable_granular_consent` (defaults to `true`, so users can untick individual scopes on the consent screen).

## Step 2: code exchange and refresh

Source: https://developers.google.com/identity/protocols/oauth2/web-server

Endpoint: `POST https://oauth2.googleapis.com/token`, `Content-Type: application/x-www-form-urlencoded`.

Code exchange body (suprstar): `client_id`, `client_secret`, `code`, `grant_type=authorization_code`, `redirect_uri` (must equal the one used in step 1).

Refresh body (suprstar, card-back "Refresh token" button): `client_id`, `client_secret`, `grant_type=refresh_token`, `refresh_token`.

Token response fields: `access_token`, `expires_in` (seconds; Google does not state the number on the page, typically 3600, **unverified**), `refresh_token` ("only if `access_type=offline`"), `scope` (space-delimited granted scopes), `token_type` (`Bearer`), and `refresh_token_expires_in` when the user granted time-based access.

suprstar stores `access_token`, `refresh_token` (keeps the previous one when the response omits it, which refresh responses always do) and `tokenExpiresAt = now + expires_in`. Refresh responses never include a new refresh token; the original one stays valid until revoked or expired.

Revocation endpoint (not called by suprstar): `https://oauth2.googleapis.com/revoke?token=...`.

## Scopes suprstar requests

Sources: https://developers.google.com/youtube/v3/guides/auth/installed-apps, https://developers.google.com/youtube/reporting/guides/authorization, https://developers.google.com/youtube/v3/docs/videos/insert, https://developers.google.com/youtube/analytics/reference/reports/query

| Scope | Consent-screen text | Unlocks in suprstar |
|---|---|---|
| `https://www.googleapis.com/auth/youtube.upload` | "Manage your YouTube videos" | `videos.insert` (publish). Listed as an accepted scope for `videos.insert` alongside `youtube`, `youtubepartner`, `youtube.force-ssl`. |
| `https://www.googleapis.com/auth/youtube.readonly` | "View your YouTube account" | `channels.list?mine=true` (connection test, profile, subscriber count). Also accepted by Analytics `reports.query`. |
| `https://www.googleapis.com/auth/yt-analytics.readonly` | "View YouTube Analytics reports for your YouTube content" | Analytics `reports.query` (requested but unused today; needed when `fetchMetrics` is implemented). |

All three are sensitive scopes and trigger the verification requirement for apps `In production`. If the user unticks a scope on the granular consent screen, the token's `scope` field will not contain it and the corresponding call fails with `403 insufficientPermissions` ("The OAuth 2.0 token provided specifies scopes insufficient for accessing the requested data.").

Scopes not requested by suprstar: `youtube` (full manage; would allow `videos.update`/`delete`), `youtube.force-ssl`, `yt-analytics-monetary.readonly`.

## Token lifetimes and refresh rules

Sources: https://developers.google.com/identity/protocols/oauth2/web-server, https://developers.google.com/identity/protocols/oauth2

- Access tokens are short-lived (`expires_in`). suprstar does not refresh automatically before a publish or test; once `tokenExpiresAt` passes, every live call fails with `401` until someone presses **Refresh token** on the card back or reconnects.
- A refresh token is returned only when `access_type=offline` was in the authorization request (suprstar always sends it, plus `prompt=consent`).
- Refresh tokens stop working when:
  - "The user has revoked your app's access"
  - "The refresh token has not been used for six months"
  - "The user changed passwords and the refresh token contains Gmail scopes" (not applicable: no Gmail scopes)
  - "The user account has exceeded a maximum number of granted (live) refresh tokens" (50 per OAuth client per user; every reconnect with `prompt=consent` mints a new one, the oldest is silently invalidated)
  - "The user granted time-based access to your app and the access expired"
  - Workspace admin restrictions on the scopes
  - **Testing publishing status**: "A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of 'Testing' is issued a refresh token expiring in 7 days, unless the only OAuth scopes requested are a subset of name, email address, and user profile." YouTube scopes are not in that subset, so a Testing project forces a full reconnect every week.
- When a refresh token is dead the token endpoint returns HTTP 400 `{"error":"invalid_grant", ...}`; suprstar surfaces `error_description` (or `invalid_grant`) as the failure message and the connection must be reconnected.

## Redirect URI rules

Source: https://developers.google.com/identity/protocols/oauth2/web-server

- Must match a URI registered under the OAuth client's **Authorized redirect URIs** exactly (scheme, host, port, path, no trailing-slash tolerance).
- Scheme must be HTTPS; `http://localhost` (with any port) is exempt.
- No raw IP addresses except localhost; no `userinfo` component; no fragments; no wildcards; no path traversal (`/..`); no open redirects in the query; domain TLD must be on the public suffix list; cannot be `googleusercontent.com`.
- suprstar's suggested value is `<app origin>/api/connections/oauth/callback` (shown as a hint on the card back with a copy button). The seed data uses `http://localhost:4000/api/connections/oauth/callback`. In production the origin must be the public HTTPS host of the API server, not the SPA host if they differ.

## Common auth errors

Sources: https://developers.google.com/identity/protocols/oauth2/web-server, https://developers.google.com/youtube/v3/docs/errors

Errors from the authorization endpoint arrive on the callback as `?error=<code>` (no `code` param), which suprstar turns into "Missing code or state parameter" or forwards; errors from the token endpoint come back as JSON `{"error": "...", "error_description": "..."}`.

| Error string | Where | Meaning (Google wording) | Fix in suprstar / console |
|---|---|---|---|
| `redirect_uri_mismatch` | authorize (page shows "Error 400: redirect_uri_mismatch") or token exchange | "Provided redirect_uri doesn't match registered URIs" | Copy the card-back Redirect URI verbatim into the OAuth client's Authorized redirect URIs; check http vs https, port, trailing slash. |
| `invalid_client` | token | "OAuth client secret incorrect" (also wrong client_id) | Re-paste Client ID/secret from the Cloud console; make sure the client type is Web application. |
| `deleted_client` | authorize | "OAuth client has been deleted" | Create a new OAuth client and update credentials. |
| `invalid_grant` | token (exchange or refresh) | "Token expired or invalidated; re-authenticate user" / code invalid, already used, or refresh token revoked/expired | Reconnect. If it recurs every 7 days, publish the consent screen (Testing -> In production). |
| `invalid_request` | authorize/token | "Request improperly formatted or missing required parameters" | Check scopes are space-separated, `code` present, form-encoded body. |
| `access_denied` | authorize | User declined, or (Testing) user is not on the test-user list | Add the Google account under OAuth consent screen > Test users, or publish the app; retry Connect. |
| `admin_policy_enforced` | authorize | "Google Account unable to authorize scopes due to workspace administrator policies" | Workspace admin must allow the app / scopes; use a different account. |
| `org_internal` | authorize | "OAuth client limited to Google Cloud Organization accounts" | Consent screen user type is Internal; switch to External or use an org account. |
| `disallowed_useragent` | authorize | "Authorization endpoint in embedded user-agent disallowed by OAuth 2.0 Policies" | Open Connect in a real browser tab, not an in-app webview. |
| `unauthorized_client` | token | Client not authorized for this grant type | OAuth client must be a Web application client. |
| `401 authorizationRequired` | Data API | "The request uses the `mine` parameter but is not properly authorized." | Access token missing/expired: Refresh token or reconnect. |
| `401 youtubeSignupRequired` | Data API | "The user has an unlinked Google Account without a YouTube channel." | Create a channel for that Google account on youtube.com, then reconnect. |
| `403 insufficientPermissions` | Data API | "The OAuth 2.0 token provided specifies scopes insufficient for accessing the requested data." | Re-tick the missing scope on the card back and reconnect (prompt=consent re-asks). |
| `403 forbidden` / `accessNotConfigured` (**unverified** reason string) | Data API | API not enabled in the project | Enable YouTube Data API v3 in the Cloud project that owns the Client ID. |
| "No YouTube channel found for this account." | suprstar | `channels.list?mine=true` returned no items | Same as `youtubeSignupRequired`: the Google account has no channel, or the wrong Google account was chosen at consent. |
| "Google hasn't verified this app" screen | authorize | Unverified app with sensitive scopes | Expected in Testing (click Continue as a test user); for the public, complete verification. |

## Suprstar card-back fields mapped to Google

| Card-back field | Google Cloud location |
|---|---|
| Client ID / Client secret | APIs & Services > Credentials > OAuth 2.0 Client IDs (Web application) |
| Redirect URI | same client > Authorized redirect URIs |
| Scopes (checkboxes) | OAuth consent screen > Scopes (must include the same three for verification; the token only carries what the user granted) |
| Mode | n/a (Live hits Google; Sandbox never does) |
| Token status / Refresh token | uses `refresh_token` stored at connect; empty if the user connected before `access_type=offline` was in effect or Google reused an existing grant |
