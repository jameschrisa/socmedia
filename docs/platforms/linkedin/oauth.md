---
platform: linkedin
topic: oauth
sources:
  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access
  - https://learn.microsoft.com/en-us/linkedin/marketing/integrations/archived-recent-changes/2020/marketing-api-changes
  - https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling
fetched: 2026-09-19
---

# LinkedIn: OAuth 2.0 for suprstar

suprstar uses LinkedIn's 3-legged Authorization Code Flow with no PKCE (LinkedIn's documented flow does not use `code_challenge`; `state` is the only CSRF control). This file walks the flow as suprstar implements it, then lists the scopes, token rules and exact error strings.

## Flow as implemented in suprstar

1. User clicks **Connect** on a LinkedIn card in Social Profiles. `POST /api/connections/:id/connect` builds the authorize URL with `state` = base64url JSON `{ "connectionId": "<id>" }`. In Sandbox mode the server short-circuits: no LinkedIn call is made and a fake token is stored.
2. Browser is sent to `https://www.linkedin.com/oauth/v2/authorization`.
3. LinkedIn redirects to the card's **Redirect URI** with `code` and `state`.
4. `GET /api/connections/oauth/callback` decodes `state`, calls `exchangeCode` (POST `https://www.linkedin.com/oauth/v2/accessToken`), then `fetchProfile` (GET `https://api.linkedin.com/v2/userinfo`), stores `accessToken`, `tokenExpiresAt`, `credentials.extra.sub`, and marks the connection `connected`.
5. On any failure in step 4 the server redirects to `/connections?error=<message>` where `<message>` is LinkedIn's `error_description` or `error` string, or suprstar's own `LinkedIn token exchange failed (<status>)` / `LinkedIn profile fetch failed (<status>)`.

Source: `server/src/routes/connections.ts`, `server/src/platforms/linkedin.ts` (suprstar)

## Step 1: App configuration (Developer Portal)

- Create/select the app at https://www.linkedin.com/developers/apps, open the **Auth** tab for **Client ID** and **Client Secret**. Paste both into the suprstar card back ("API credentials" section).
- Add the redirect URL under the Auth tab ("Authorized redirect URLs for your app"). The value must be byte-identical to the card's **Redirect URI** field. suprstar suggests `${window.location.origin}/api/connections/oauth/callback`.

LinkedIn's redirect URL rules (quoted):

- "URLs must be absolute: `https://dev.example.com/auth/linkedin/callback` not `/auth/linkedin/callback`"
- "Parameters are ignored: `https://dev.example.com/auth/linkedin/callback?id=1` will be `https://dev.example.com/auth/linkedin/callback`"
- "URLs cannot include a #"
- Redirect URLs are added "via HTTPS". `http://localhost:...` is commonly accepted for development but that is unverified on the official page; production must be HTTPS.

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow

## Step 2: Authorization request

```
GET https://www.linkedin.com/oauth/v2/authorization
```

| Parameter | suprstar value | LinkedIn rule |
| --- | --- | --- |
| `response_type` | `code` | "should always be: code" |
| `client_id` | card Client ID | must match the app |
| `redirect_uri` | card Redirect URI | "must match one of the Redirect URLs defined in your application configuration" |
| `state` | base64url `{"connectionId":...}` | optional but recommended; suprstar requires it on callback |
| `scope` | space-joined list from the card's Scopes checkboxes; defaults to `openid profile w_member_social r_organization_social w_organization_social` | "URL-encoded, space-delimited list of member permissions"; only scopes shown on the app's Auth tab may be requested |

Behaviour notes from LinkedIn:

- "If multiple scopes are requested, the user must consent to all of them and may not select the individual scopes."
- "If the scope permissions are changed in your app, your users must re-authenticate."
- If a grant already exists and the member is logged in, "the authorization screen is bypassed and the member is immediately redirected to the URL provided in the redirect_uri query parameter."
- Member cancels: redirect carries `error=user_cancelled_login` ("The member declined to log in to their LinkedIn account") or `error=user_cancelled_authorize` ("The member refused to authorize the permissions request from your application"), plus `error_description` and `state`. suprstar's callback only reads `code` and `state`, so a cancel surfaces as `/connections?error=Missing%20code%20or%20state%20parameter`.

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow

## Step 3: Token exchange

```
POST https://www.linkedin.com/oauth/v2/accessToken
Content-Type: application/x-www-form-urlencoded
grant_type=authorization_code&code=...&client_id=...&client_secret=...&redirect_uri=...
```

- "the authorization code has a 30-minute lifespan and must be used immediately."
- Response: `access_token`, `expires_in` (5184000 = 60 days), `scope`, and, only for apps enabled for programmatic refresh, `refresh_token` and `refresh_token_expires_in`.
- Tokens are "~500 characters"; LinkedIn recommends storage for "at least 1000 characters".
- "If you request a different scope than the previously granted scope, all the previous access tokens are invalidated." Changing the Scopes checkboxes on a card and reconnecting will invalidate tokens held by sibling cards that share the same app.

suprstar stores `access_token` and `expires_in` only. It **does not store `refresh_token`** even when LinkedIn returns one. See "Refresh" below.

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow

## Scopes suprstar requests and what each unlocks

| Scope | Product | Unlocks in suprstar |
| --- | --- | --- |
| `openid` | Sign In with LinkedIn using OpenID Connect | Makes `/v2/userinfo` callable; returns ID token. Required for the connection test. |
| `profile` | Sign In with LinkedIn using OpenID Connect | `sub` (used to build `urn:li:person:{sub}`), `name` (display name), `picture` (avatar). |
| `w_member_social` | Share on LinkedIn (self-serve) or Community Management | `POST /rest/posts` with `author: urn:li:person:{sub}`; `POST /rest/images?action=initializeUpload` with `owner: urn:li:person:{sub}`. Write-only: "tokens with only w_member_social permissions would be unable to perform a GET call for rest/images". |
| `r_organization_social` | Community Management API (vetted) | Read organization posts/comments; not currently used by any suprstar call. |
| `w_organization_social` | Community Management API (vetted) | `POST /rest/posts` and image upload with `author`/`owner` = `urn:li:organization:{id}`; member must hold `ADMINISTRATOR`, `DIRECT_SPONSORED_CONTENT_POSTER` or `CONTENT_ADMIN` on that Page. |

Not requested: `email` (so `/v2/userinfo` omits `email`; suprstar's `handle` falls back to the previous value), `rw_organization_admin` (needed for `organizationalEntityShareStatistics` metrics, see `publishing.md`).

Practical rule: an app that only has the two self-serve products must have `r_organization_social` and `w_organization_social` **unchecked** on the card, otherwise authorization fails with `unauthorized_scope_error` / "Invalid scope" (below).

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api

## Profile fetch and connection test

```
GET https://api.linkedin.com/v2/userinfo
Authorization: Bearer <access token>
```

Response fields: `sub`, `name`, `given_name`, `family_name`, `picture`, `locale`, optional `email`, `email_verified`. LinkedIn: "The 'email' and 'email_verified' fields are optional and may not be included in all responses."

suprstar maps `name` -> displayName, `picture` -> avatarUrl, `sub` -> `credentials.extra.sub`, and `email.split("@")[0]` -> handle only when `email` is present. **Test connection** on the card is exactly this call; success returns "Connected to LinkedIn", failure returns LinkedIn's `message` or `LinkedIn profile fetch failed (<status>)`.

Source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2

## Token lifetimes and refresh rules

| Token | Lifetime | Notes |
| --- | --- | --- |
| Authorization code | 30 minutes | single use |
| Access token | 60 days | "Currently, all access tokens are issued with a 60-day lifespan." |
| Programmatic refresh token | 365 days | Only "for all approved Marketing Developer Platform (MDP) partners". TTL does not reset on use: "on Day 360 ... your access token and refresh token will both expire in 5 days". |

Refresh request (only works if the app is enabled for programmatic refresh tokens):

```
POST https://www.linkedin.com/oauth/v2/accessToken
grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...
```

Without programmatic refresh, LinkedIn's documented "refresh" is to send the member through the authorization URL again; if they are still logged in and the current token is unexpired, "the authorization screen is bypassed".

### How suprstar's "Refresh token" button behaves

The card-back **Refresh token** button calls `POST /api/connections/:id/refresh`, which sends `grant_type=refresh_token` with `refresh_token: conn.credentials.refreshToken || ""`. Because `exchangeCode` never saves `refresh_token`, the value is always empty, and LinkedIn answers:

```
400 invalid_request "A required parameter "refresh_token" is missing"
```

suprstar shows this as the toast/error text `A required parameter "refresh_token" is missing` (from `error_description`). Even after the adapter is fixed to persist `refresh_token`, refresh only succeeds for MDP-approved apps. For everyone else the operating rule is: **reconnect before the 60-day expiry** (the card's Token status shows `tokenExpiresAt`). There is no automatic refresh before publish; a post scheduled after expiry fails with a 401 (see `errors.md`).

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens, `server/src/platforms/linkedin.ts` (suprstar)

## Revocation

"The access token has been revoked by the member from their privacy settings on LinkedIn's website. To continue using your application, the member has to re-authenticate." Also: "LinkedIn reserves the right to revoke Refresh Tokens or Access Tokens at any time due to technical or policy reasons"; apps are expected "to fallback to the standard OAuth flow". In suprstar: Disconnect, then Connect again.

Source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling

## Common auth errors (exact strings) and fixes

### At `/oauth/v2/authorization` (shown on LinkedIn's page or in the redirect)

| HTTP | Error message | Meaning | Fix in suprstar |
| --- | --- | --- | --- |
| 401 | `Redirect_uri doesn't match` | "Redirect URI passed in the request does not match the redirect URI added to the developer application." | Card **Redirect URI** must equal an entry under the app's Auth tab, including scheme, host, port, path, no trailing `#`. |
| 401 | `Client_id doesn't match` | "Client ID passed in the request does not match the client ID of the developer application." | Re-paste **Client ID** from the Auth tab; check for whitespace. |
| 401 | `Invalid scope` | "Permissions passed in the request is invalid" | Untick scopes the app has not been granted (Auth tab lists them). Typically `r_organization_social` / `w_organization_social` on an app without Community Management. |
| n/a | `unauthorized_scope_error` | "Requesting permissions that your application doesn't have will result in an error (unauthorized_scope_error)" | Same as above. |
| redirect | `error=user_cancelled_login` / `error=user_cancelled_authorize` | Member cancelled | Retry Connect; suprstar surfaces as "Missing code or state parameter". |
| page | "Bummer, something went wrong" | LinkedIn's generic authorization error page. Not documented with a specific cause on learn.microsoft.com (unverified); in practice it accompanies scope/redirect mismatches. | Check redirect URI and scopes first, then client ID. |

### At `/oauth/v2/accessToken` (surfaced as `/connections?error=...`)

| HTTP | Error | Description (LinkedIn) | Fix |
| --- | --- | --- | --- |
| 401 | `invalid_request` "Unable to retrieve access token: authorization code not found" | code invalid/unknown | Reconnect; the code was already consumed or mangled. |
| 400 | `invalid_redirect_uri` "Unable to retrieve access token: appid/redirect uri/code verifier does not match authorization code. Or authorization code expired. Or external member binding exists" | redirect_uri on the token call differs from the authorize call, or the code is older than 30 minutes | Do not edit the card's Redirect URI between Connect and callback; retry within 30 minutes. |
| 400 | `invalid_request` "A required parameter "redirect_uri" is missing" | missing param | Card Redirect URI is blank. |
| 400 | `invalid_request` "A required parameter "client_secret" is missing" | missing param | Card Client secret is blank. |
| 400 | `invalid_request` "A required parameter "client_id" is missing" | missing param | Card Client ID is blank. |
| 400 | `invalid_request` "The provided authorization grant or refresh token is invalid, expired or revoked" | refresh token bad/expired/revoked | Reconnect. |
| 400 | `invalid_request` "A required parameter "refresh_token" is missing" | refresh called with empty token | Expected in current suprstar (see above). Reconnect instead. |
| 400/401 | `invalid_client` | Wrong client secret (message text unverified on official page) | Re-paste Client secret. |

### At API calls with the token (401)

| Message | Fix |
| --- | --- |
| `Empty oauth2_access_token` / "Empty OAuth2 access token" | No token stored; Connect. |
| "Invalid access token" | Token corrupted or from another app; Disconnect and Connect. |
| "Expired access token" | 60 days elapsed; Connect again. |
| "The token has been revoked" | Member revoked in LinkedIn settings; Connect again. |
| "Unknown authentication schema" | Header not `Authorization: Bearer ...` (not expected from suprstar). |

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow, https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens, https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling

## Manual token generation (debugging)

The Developer Portal has a token generator (https://www.linkedin.com/developers/tools/oauth/token-generator) and a token inspector. A token minted there can be pasted directly into suprstar only by editing the stored connection; the card UI does not expose an access-token field. Useful for confirming whether a failure is OAuth-related or API-related.

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
