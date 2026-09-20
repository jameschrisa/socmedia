---
platform: instagram
topic: oauth
sources:
  - https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
  - https://developers.facebook.com/docs/facebook-login/guides/access-tokens
  - https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
  - https://developers.facebook.com/docs/graph-api/reference/debug_token
  - https://developers.facebook.com/docs/graph-api/guides/error-handling
  - https://developers.facebook.com/docs/graph-api/overview/access-levels
  - https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started
  - https://developers.facebook.com/docs/instagram-platform/overview
  - https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
fetched: 2026-09-19
---

# Instagram OAuth (Facebook Login) as used by suprstar

## Flow summary in suprstar

Source: `server/src/platforms/instagram.ts`, `server/src/routes/connections.ts` (app code).

1. User presses **Connect** on the Instagram Social Profile card. `POST /api/connections/:id/connect` returns `authorizeUrl` built from the card-back credentials; the browser is sent there. (In Sandbox mode this step fakes a token and returns immediately; no Facebook dialog appears.)
2. Facebook shows the login dialog, then redirects to the card's **Redirect URI** with `code` and `state`.
3. `GET /api/connections/oauth/callback` decodes `state` (base64url JSON `{connectionId}`), exchanges `code` for a **short-lived** user access token, calls `/me/accounts` and `/{ig-user-id}` to fill display name, handle, avatar and followers, saves `status: "connected"`, and redirects to `/connections?connected=instagram`.
4. On any failure the callback redirects to `/connections?error=<message>` where `<message>` is the Graph API `error.message` or one of the app's own strings.
5. The token is **not** upgraded to long-lived automatically. Pressing **Refresh token** on the card back runs `grant_type=fb_exchange_token` against the stored token, which is the only way suprstar obtains the ~60-day token. There is no automatic refresh before publish or test.

## Step 1: authorization request

Source: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow

suprstar builds:

```
https://www.facebook.com/v21.0/dialog/oauth
  ?client_id={App ID}
  &redirect_uri={Redirect URI from card back}
  &state={base64url JSON}
  &response_type=code
  &scope=instagram_basic,instagram_content_publish,instagram_manage_insights,pages_show_list,pages_read_engagement
```

Parameters per Meta:

- `client_id` (required): the App ID from the App Dashboard.
- `redirect_uri` (required): "must match 'Valid OAuth Redirect URIs' in App Dashboard settings"; must use HTTPS; must match exactly (scheme, host, path, trailing slash).
- `state` (required): CSRF token, "returned unchanged in redirect". suprstar uses it to find the connection, so a missing or altered `state` yields the app error `Missing code or state parameter` or `Unknown connection`.
- `response_type`: `code` (default; server-side exchange). Other values (`token`, `code token`, `granted_scopes`) are not used.
- `scope`: "Comma or space-separated list of requested permissions". suprstar joins with commas; the card back lets the user untick scopes, and a connection with an empty scope list falls back to the five defaults.
- `auth_type=rerequest`: "Explicitly tell the dialog you're re-asking for a declined permission". suprstar does not send it, so a user who previously declined a permission must revoke the app in Facebook settings and reconnect (see fixes below).
- PKCE (`code_challenge`) is not part of the Facebook manual flow and suprstar does not send it.

If the user cancels, Facebook redirects with `error_reason=user_denied`, `error=access_denied`, `error_description=Permissions+error`. suprstar's callback then sees no `code` and reports `Missing code or state parameter`.

## Step 2: code exchange (short-lived token)

Source: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow

```
GET https://graph.facebook.com/v21.0/oauth/access_token
  ?client_id={App ID}
  &client_secret={App Secret}
  &redirect_uri={same Redirect URI}
  &code={code}
```

Response: `{"access_token": "...", "token_type": "bearer", "expires_in": <seconds>}`. Per Meta, `redirect_uri` "must match original request exactly". suprstar stores `access_token` and computes `tokenExpiresAt = now + expires_in`.

The token is a short-lived **User access token**: "short-lived tokens typically last about one to two hours" (https://developers.facebook.com/docs/facebook-login/guides/access-tokens). After it expires every Live call fails with code `190`.

## Step 3: long-lived token (card back "Refresh token")

Source: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived

```
GET https://graph.facebook.com/v21.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={App ID}
  &client_secret={App Secret}
  &fb_exchange_token={current access token}
```

Rules from Meta:

- Long-lived User tokens last "approximately 60 days".
- "You can not use an expired token to request a long-lived token." Users must log in again if the short-lived token has already expired.
- The exchange must be done server-side (the App Secret is in the request); suprstar does this from the server.
- Whether a long-lived token can be exchanged again, any minimum token age, or user-activity conditions: **not stated on the official page** (unverified). Meta's SDKs "automatically refresh tokens if users engaged with the app within 90 days". The 24-hour minimum age rule is documented only for the Instagram Login path (`ig_refresh_token`), not for `fb_exchange_token`.
- Long-lived **Page** tokens have "no expiration date" but suprstar never requests Page tokens; it uses the User token for `/{ig-user-id}/media`, which Meta permits with the listed permissions.

Operational rule for suprstar: after every successful Connect, press **Refresh token** once within the first hour. The card's Token status then shows an expiry roughly 60 days out. Repeat before day 60. If the token has already expired, Refresh fails (code `190`) and the account must be reconnected.

## Scopes and what each unlocks

Source: https://developers.facebook.com/docs/instagram-platform/overview, https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started, https://developers.facebook.com/docs/instagram-platform/content-publishing, https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights. The per-permission reference pages (`/docs/permissions/reference/*`) returned HTTP 500 during this pull; the descriptions below come from the endpoint references that list required permissions.

| Scope (card back) | Needed for | suprstar call that requires it |
|---|---|---|
| `pages_show_list` | Listing the user's Pages | `GET /me/accounts` (get-started guide requests `instagram_basic` + `pages_show_list` for this step) |
| `instagram_basic` | Reading the IG professional account and its media | `/me/accounts?fields=instagram_business_account`, `/{ig-user-id}?fields=username,...`, container status reads |
| `pages_read_engagement` | Listed as required alongside `instagram_basic` for IG User, IG Media, IG Container reads and for publishing | profile fetch, `/{container-id}?fields=status_code`, `/media`, `/media_publish` |
| `instagram_content_publish` | Creating containers and publishing | `POST /{ig-user-id}/media`, `POST /{ig-user-id}/media_publish`, `GET /content_publishing_limit` |
| `instagram_manage_insights` | Account and media insights | `GET /{ig-user-id}/insights` (currently discarded by the adapter) |

Additional permissions Meta says may be required but suprstar does not request: `ads_management` or `ads_read` "if the user has a Page role via Business Manager" (publishing and insights references). A Business-Manager-assigned user may therefore get code `200` "The calling app is missing the ads_management..." on publish; fix by adding the Page role directly on the Page or by adding `ads_management` to the app's scopes (requires App Review for Advanced Access).

Unticking any of the five scopes on the card back breaks a specific step: no `pages_show_list` or `instagram_basic` breaks Connect (profile fetch fails), no `instagram_content_publish` breaks Publish, no `instagram_manage_insights` breaks Metrics.

## Token inspection

Source: https://developers.facebook.com/docs/graph-api/reference/debug_token

```
GET https://graph.facebook.com/v21.0/debug_token?input_token={token}&access_token={App ID}|{App Secret}
```

Response `data` fields: `app_id`, `application`, `type`, `data_access_expires_at`, `expires_at`, `is_valid`, `issued_at`, `scopes`, `granular_scopes` (permission with target Page/IG IDs), `user_id`, `error` (`code`, `message`, `subcode`). Use it to confirm which of the five scopes were actually granted and whether the token is short-lived (expires within hours) or long-lived. suprstar does not expose this call; run it manually or in the Graph API Explorer.

## Redirect URI rules

Source: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow

- Must be listed verbatim under Facebook Login > Settings > **Valid OAuth Redirect URIs**.
- Must be HTTPS. `http://localhost` is not accepted for a Live-mode redirect; Meta's dev tooling allows localhost only while the app is in Development mode (unverified for the exact current rule; use an HTTPS tunnel when in doubt).
- The same value must be sent in the dialog request and the `oauth/access_token` exchange. suprstar uses `conn.credentials.redirectUri` for both, so only the card-back value matters; the suggested value shown under the field is `{window.location.origin}/api/connections/oauth/callback`.
- Query strings and fragments in the redirect URI are a common cause of mismatch; keep the value plain.

## Common auth errors and fixes

Source: https://developers.facebook.com/docs/graph-api/guides/error-handling and https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow. Messages shown in the dialog itself are quoted where Meta documents them; dialog-page copy that is not on the fetched pages is marked unverified.

| Symptom / error | Exact code or text | Meaning | Fix in suprstar / Meta dashboard |
|---|---|---|---|
| Dialog page error before login | "Can't Load URL: The domain of this URL isn't included in the app's domains." (unverified wording) / redirect mismatch | `redirect_uri` not in Valid OAuth Redirect URIs, or wrong scheme | Copy the card-back Redirect URI exactly into Facebook Login > Settings > Valid OAuth Redirect URIs; ensure HTTPS; save; retry Connect |
| Redirect back with `error=access_denied&error_reason=user_denied&error_description=Permissions+error` | user cancelled or declined | callback has no `code` | Reconnect; if a scope was declined, revoke the app under Facebook Settings > Apps and Websites, then reconnect (suprstar does not send `auth_type=rerequest`) |
| `/connections?error=Missing%20code%20or%20state%20parameter` | app string | Facebook returned without `code`/`state` | Same as above; also check the redirect URI does not strip query params (reverse proxy) |
| `/connections?error=Unknown%20connection` | app string | `state` decoded to a connection id that no longer exists | The card was deleted mid-flow; create the account again and reconnect |
| Token exchange fails | code `100`, `OAuthException`, message like "Invalid verification code format." or "This authorization code has expired." (dialog wording partially unverified) | `code` reused, expired, or `redirect_uri` differs between dialog and exchange | Retry Connect once; do not refresh the callback page; make sure the card-back Redirect URI was not edited between the two steps |
| Token exchange fails | code `101` "Error validating application. Invalid application ID." (unverified exact wording) or `OAuthException` about client secret | Wrong App ID or App Secret on the card back | Re-copy App ID and App Secret from App Dashboard > App settings > Basic; App Secret may have been reset |
| Login dialog says app is in development mode / user cannot log in | Development mode gate | Connecting user has no role on the app | Add the Facebook user as Admin/Developer/Tester under App Roles, have them accept, retry; or complete App Review and switch to Live |
| Permissions silently missing (`debug_token` `scopes` lacks a permission) | no error | Permission only has Standard Access and user has no app role, or Facebook Login for Business configuration does not include it | Add the user as a role user, or request Advanced Access via App Review; check the Login for Business configuration includes the permission |
| Calls fail after ~1 h | code `190`, subcode `463`, `OAuthException` "Error validating access token: Session has expired..." | Short-lived token expired; Refresh was never pressed | Reconnect, then press **Refresh token** immediately to get the 60-day token |
| Calls fail after ~60 d | code `190`, subcode `463` | Long-lived token expired | Reconnect and refresh again; schedule a refresh before day 60 |
| Refresh token fails | code `190` | "You can not use an expired token to request a long-lived token." | Reconnect first, then refresh |
| Calls fail suddenly | code `190`, subcode `460` "Error validating access token: The session has been invalidated because the user changed their password" | Password changed | Reconnect |
| Calls fail suddenly | code `190`, subcode `458` "Error validating access token: The user has not authorized application" | User removed the app in Facebook settings (revoked access) | Reconnect |
| Calls fail suddenly | code `190`, subcode `467` "Error validating access token: The access token is invalid" / `459` user checkpointed / `464` unconfirmed user | Session invalid or account needs action on facebook.com | Have the user log in to Facebook/Instagram and clear checkpoints, then reconnect |
| Calls fail with `492` | subcode `492` "Invalid Session" | User lacks the appropriate Page role | Give the Facebook user a role on the Page linked to the IG account (Page settings > Page access) |
| Permission error on read/publish | code `10` "(#10) Application does not have permission for this action" or codes `200-299` | Scope not granted, not approved, or app not Live for a non-role user | Verify scopes on the card back; verify grant with `debug_token`; check App Review status and access level |
| Profile fetch after login fails | app string `No Facebook Page with a linked Instagram Business account was found.` | `/me/accounts` returned no Page with `instagram_business_account` | Link the IG professional account to a Facebook Page (Instagram settings > Business tools and controls > Connect a Facebook Page); ensure the Facebook user has a task role on that Page; alternatively enter the IG user ID in the card-back **Instagram business account ID** field (bypasses the Page lookup for publish, but not for Connect/Test) |

## Data access expiry and invalidation

Source: https://developers.facebook.com/docs/graph-api/reference/debug_token (field `data_access_expires_at`); the 90-day inactivity rule is not on the fetched pages (unverified). Treat a token as dead when `debug_token` returns `is_valid: false`; the `error` object in that response carries the code/subcode to map with the table above.

## Reference: Instagram Login path (not used)

Source: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login

For comparison only. Authorize at `https://www.instagram.com/oauth/authorize` with `client_id`, `redirect_uri`, `response_type=code`, `scope` (`instagram_business_basic`, `instagram_business_content_publish`, ...), `state`. Codes are "valid for 1 hour, single-use". Exchange with `POST https://api.instagram.com/oauth/access_token` (`client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`). Long-lived: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=...` (60 days). Refresh: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=...`; the token "must be at least 24 hours old, valid, and not expired". Denied login returns `error=access_denied&error_reason=user_denied`.
