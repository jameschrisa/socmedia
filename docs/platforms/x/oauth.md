---
platform: x
topic: oauth
sources:
  - https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
  - https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
  - https://docs.x.com/fundamentals/authentication/oauth-2-0/overview
  - https://docs.x.com/fundamentals/authentication/api-reference
  - https://docs.x.com/fundamentals/authentication/faq
  - https://docs.x.com/fundamentals/developer-apps
  - https://docs.x.com/x-api/users/user-lookup-me
  - https://docs.x.com/x-api/fundamentals/response-codes-and-errors
fetched: 2026-09-19
---

# X — OAuth 2.0 Authorization Code with PKCE

suprstar has no X adapter yet (see `overview.md`). This file documents the flow an X adapter must implement and the errors the in-app agent should expect once it exists.

## Flow summary

Source: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code

X supports exactly two OAuth 2.0 grant types for user context: "authorization code with PKCE and refresh token". PKCE is mandatory — the authorize request is rejected without `code_challenge`.

1. Generate a `code_verifier` (random string) and derive `code_challenge` (`S256`: base64url(SHA-256(verifier)); or `plain`: the verifier itself). Persist the verifier server-side keyed by `state`.
2. Redirect the user to `https://x.com/i/oauth2/authorize?...`.
3. X redirects back to `redirect_uri` with `?state=...&code=...`.
4. Exchange `code` + `code_verifier` at `POST https://api.x.com/2/oauth2/token`.
5. Store `access_token` (2 h) and, if `offline.access` was granted, `refresh_token`.
6. Refresh with `grant_type=refresh_token` before the 2-hour expiry. Each refresh returns a **new** refresh token; the old one is invalidated.

### Mapping onto suprstar

- suprstar's `POST /api/connections/:id/connect` calls `adapter.buildAuthorizeUrl(conn, state)` where `state = base64url(JSON.stringify({ connectionId }))`. For X the adapter must additionally create and store a `code_verifier` for that `state` (e.g. in `conn.credentials.extra.pkceVerifier` saved before returning the URL, or a short-lived server map). The generic callback `GET /api/connections/oauth/callback` then calls `adapter.exchangeCode(conn, code)`, which must read the verifier back.
- The existing callback redirects on any failure to `${clientUrl}/connections?error=<message>`; X's `error_description` string will surface there.
- `refreshToken` on the adapter must write back **both** `accessToken` and the rotated `refreshToken`; the TikTok adapter (`data.refresh_token ?? conn.credentials.refreshToken`) is the right template. Storing only the access token (as the YouTube/LinkedIn adapters do) would break X after the first refresh.
- suprstar does **not** auto-refresh before publishing (only the manual "Refresh token" button on the card back and `POST /:id/refresh` exist). With a 2-hour access token this means an X connection would fail to publish roughly two hours after connecting unless the adapter's `publish`/`fetchProfile` refresh on demand. Flag this as a required behaviour for the X adapter.

## Step 1: Authorization request

Source: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code

Endpoint: `GET https://x.com/i/oauth2/authorize` (the `twitter.com` host also worked historically; docs.x.com now documents only `x.com` — using `twitter.com` is unverified).

Required query parameters (exact names, descriptions quoted from the page):

| Parameter | Value / doc wording |
|---|---|
| `response_type` | `code` — "Specify that this is a code with the word 'code'" |
| `client_id` | "Can be found in the Developer Console under the header 'Client ID'" |
| `redirect_uri` | "Your callback URL...must correspond to one of the Callback URLs defined in your App's settings"; validation is "exact match validation" |
| `scope` | Space-separated list (URL-encoded as `%20`), e.g. `tweet.read%20users.read` |
| `state` | "A random string you provide to verify against CSRF attacks...up to 500 characters" |
| `code_challenge` | "A PKCE parameter, a random secret for each request you make" |
| `code_challenge_method` | "Specifies the method you are using to make a request (S256 OR plain)" |

Documented example:

```
https://x.com/i/oauth2/authorize?response_type=code&client_id=M1M5R3BMVy13QmpScXkzTUt5OE46MTpjaQ&redirect_uri=https://www.example.com&scope=tweet.read%20users.read&state=state&code_challenge=challenge&code_challenge_method=plain
```

Use `S256` in production. The user-access-token guide's examples use `plain` and say to "use a random string for the `code_challenge`" only for illustration; S256 derivation itself is not spelled out on the page (standard RFC 7636: `BASE64URL(SHA256(ASCII(code_verifier)))`, verifier 43–128 chars).

Callback shape on success: `https://www.example.com/?state=state&code=[AUTH_CODE]`.

Authorization code lifetime: "30 seconds once the App owner receives an approved auth_code". Exchange it immediately.

## Step 2: Token exchange

Source: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code , https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token

Endpoint: `POST https://api.x.com/2/oauth2/token`, `Content-Type: application/x-www-form-urlencoded`.

Confidential client (suprstar — app type "Web App"):

```
POST https://api.x.com/2/oauth2/token
Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
Content-Type: application/x-www-form-urlencoded

code=[AUTH_CODE]&grant_type=authorization_code&redirect_uri=[SAME_AS_AUTHORIZE]&code_verifier=[VERIFIER]
```

"You don't need client id for confidential clients with a valid Authorization Header. You still are required to include Client Id in the body for the requests with a public client."

Public client (not suprstar's case): same body plus `client_id=[CLIENT_ID]`, no Basic header.

`redirect_uri` in the token request "must match authorize URL value".

Token response (field list is not tabulated on the docs page; the shape below follows the standard response X returns and is **unverified verbatim**):

```json
{ "token_type": "bearer", "expires_in": 7200, "access_token": "...", "scope": "tweet.read users.read tweet.write offline.access", "refresh_token": "..." }
```

`refresh_token` is present only when `offline.access` was requested and granted.

## Step 3: Token lifetime and refresh

Source: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code

- "By default, the access token you create through the Authorization Code Flow with PKCE will only stay valid for two hours unless you've used the `offline.access` scope."
- Refresh token: "Refresh tokens allow an application to obtain a new access token without prompting the user via the refresh token flow." Only issued when `offline.access` is included.
- Refresh request (documented curl):

```
POST https://api.x.com/2/oauth2/token
Content-Type: application/x-www-form-urlencoded
(Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET) for confidential clients)

grant_type=refresh_token&refresh_token=[token_value]&client_id=[client_id]
```

- Refresh-token rotation (single use; a new refresh token comes back with every refresh) is how X behaves in practice but is **not stated on the fetched pages** — treat as unverified but design for it: always persist the newest `refresh_token`.
- Refresh-token absolute lifetime is not documented on docs.x.com (unverified; commonly reported as 6 months of inactivity).
- Revocation by the user: the FAQ states "An access token will be invalidated if a user explicitly revokes an application in their X account settings, or if X suspends an application." When that happens, "prompt the user to re-authorize the application."

## Revoke

Source: https://docs.x.com/fundamentals/authentication/api-reference (via search excerpt; direct fetch of the revoke page returned 404)

```
POST https://api.x.com/2/oauth2/revoke
Content-Type: application/x-www-form-urlencoded

token=<YOUR_TOKEN>&client_id=<YOUR_CLIENT_ID>
```

"The revoke token is for an App to revoke a token and not a user." suprstar's `POST /:id/disconnect` currently just nulls tokens locally; an X adapter could call revoke first (optional).

## Scopes suprstar needs

Source: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code (scope table), endpoint references for required scopes

| Scope | Doc description | Why suprstar needs it |
|---|---|---|
| `tweet.read` | View tweets including protected accounts | Required by `POST /2/tweets`, `DELETE /2/tweets/:id`, `GET /2/users/me`, `GET /2/tweets` (all list `tweet.read`) |
| `tweet.write` | Tweet and retweet | `POST /2/tweets`, `DELETE /2/tweets/:id` |
| `users.read` | View account information | `GET /2/users/me` (profile / connection test); also listed on `POST /2/tweets` |
| `media.write` | "Upload media, such as photos and videos, on your behalf" | `POST /2/media/upload`, `/initialize`, `/append`, `/finalize`, `GET /2/media/upload?command=STATUS`, `POST /2/media/metadata` — every v2 media reference page lists `media.write` as the OAuth2UserToken scope |
| `offline.access` | "Stay connected to your account until you revoke access" | Needed to receive a `refresh_token`; without it the connection dies after 2 hours |

Recommended default scope string for the X `PLATFORM_SPECS` entry: `tweet.read tweet.write users.read media.write offline.access` (space-separated — note TikTok/Instagram in suprstar join scopes with commas; X must use spaces like YouTube/LinkedIn).

Scopes not needed: `follows.*`, `like.*`, `dm.*`, `bookmark.*`, `list.*`, `space.read`, `mute.*`, `block.*`, `users.email`, `tweet.moderate.write`, `broadcast.*`.

The requested scopes must be compatible with the App's permission level: `tweet.write`/`media.write` require the app to be set to "Read and write" (or "Read, write, and DMs"). "Changing permissions requires users to re-authorize your app to get new tokens with the updated scope."

## Redirect URI rules

Source: https://docs.x.com/fundamentals/developer-apps

- "URLs must match exactly (including trailing slashes)"
- "Use `https://` in production"
- "For local development, use `http://127.0.0.1` (not `localhost`)"
- "Maximum of **10 callback URLs** per app"
- Website URL, Terms of Service and Privacy Policy URLs are part of the app's user-authentication settings in the console; the fetched docs pages do not list them explicitly (unverified whether they are mandatory in the 2026 console).

suprstar's card back suggests `${origin}/api/connections/oauth/callback`. For X, register that exact string (scheme, host, port, path, no trailing slash) as a Callback URI; for local dev, serve suprstar on `http://127.0.0.1:<port>` rather than `localhost`.

## Connection test call

Source: https://docs.x.com/x-api/users/user-lookup-me

`GET https://api.x.com/2/users/me?user.fields=public_metrics,profile_image_url,username,name,verified`
Auth: `Authorization: Bearer <user access token>`; scopes `users.read` and `tweet.read`.

Response `data` holds `id`, `name`, `username`, `profile_image_url`, `verified`, and `public_metrics` with `followers_count`, `following_count`, `post_count`, `listed_count` (and optionally `like_count`). The doc's `public_metrics` field is now named `post_count` (formerly `tweet_count`). Rate limit: 75 requests / 15 min per user. This is the natural `fetchProfile` / `testConnection` implementation (handle = `@username`, followers = `followers_count`, `extra.userId = data.id`).

## Common auth errors and fixes

Sources: https://docs.x.com/x-api/fundamentals/response-codes-and-errors ; OAuth error strings below marked (docs) were seen on docs.x.com, those marked (unverified) are standard OAuth 2.0 / commonly observed X responses not present on the fetched pages.

| Where | Error | Meaning | Fix |
|---|---|---|---|
| Authorize page | Browser shows an X error page instead of the consent screen ("Something went wrong" — unverified wording) | `redirect_uri` not registered / not exact match; missing `code_challenge`; `client_id` wrong; app lacks OAuth 2.0 user-auth settings | Compare the card-back Redirect URI byte-for-byte with the console Callback URI; confirm PKCE params are present; confirm you are using the OAuth 2.0 Client ID |
| Token endpoint | `{"error":"invalid_request", "error_description":"Value passed for the authorization code was invalid, or expired."}` (unverified verbatim) | Code reused, older than 30 s, or `code_verifier` does not match `code_challenge` | Exchange immediately, once; persist the verifier per `state`; do not double-fire the callback |
| Token endpoint | `invalid_grant` (unverified verbatim) | Refresh token already used, revoked, or expired | Re-run the connect flow; make sure the rotated refresh token was saved |
| Token endpoint | `invalid_client` (unverified verbatim) | Basic header wrong; API Key/Secret used instead of Client ID/Secret; secret regenerated in console | Re-enter the OAuth 2.0 Client ID / Client Secret on the card back |
| Token endpoint | `unauthorized_client` (unverified verbatim) | App type is public but a secret was sent, or grant not allowed for this app | Set app type to "Web App" (confidential) in the console |
| Token endpoint | `redirect_uri` mismatch → `invalid_request` (unverified verbatim) | `redirect_uri` on the token call differs from the authorize call | Send the identical value in both requests |
| Any API call | HTTP 401, `title: "Unauthorized"`, `type: "about:blank"`, `detail: "Unauthorized"` | Token expired (2 h), revoked by the user, or malformed `Authorization` header. Docs guidance: "Verify correct authentication method, credentials validity, and `Authorization` header format" | Refresh the token; if refresh fails, reconnect |
| Any API call | HTTP 403, `type: https://api.x.com/2/problems/not-authorized-for-resource` or `.../client-forbidden` | Docs: "Confirm app endpoint access, required enrollment status, appropriate OAuth scopes, and resource privacy settings." Typical causes: app permission is "Read only"; scope not granted; app not enrolled/attached to a Project (legacy) | Change app permission to Read and write, then **reconnect** (tokens keep the old scope); re-request the scope |
| Any API call | HTTP 403 with detail "Your client app is not configured with the appropriate oauth1 app permissions for this endpoint" (unverified verbatim; legacy `oauth1-permissions` problem type) | App permissions do not include write | Same as above |
| Any API call | HTTP 403, `client-not-enrolled`: "When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project" (unverified verbatim; type not on the current docs page) | Legacy standalone app | Create/attach the app under a Project in the console |
| Any API call | HTTP 401 "Unsupported Authentication" (unverified verbatim; `unsupported-authentication` type) | App-only Bearer token used on a user-context endpoint (`POST /2/tweets`, `/2/users/me`) | Use the user's OAuth 2.0 access token, not the app Bearer Token |
| Any API call | HTTP 429, `type: .../rate-limit-exceeded` or `.../usage-capped`; legacy body `"code": 88, "message": "Rate limit exceeded"` | Per-endpoint window exhausted or monthly cap/credits exhausted | Wait for `x-rate-limit-reset`; buy credits |

## Alternative: OAuth 1.0a

Source: https://docs.x.com/fundamentals/authentication/overview

Every v2 endpoint suprstar needs (`POST /2/tweets`, media upload, `/2/users/me`) also accepts "UserToken (HTTP OAuth)" i.e. OAuth 1.0a user context with API Key/Secret + Access Token/Secret. OAuth 1.0a tokens do not expire ("Access tokens are not explicitly expired"). This avoids the 2-hour refresh problem but requires request signing and does not fit suprstar's client-id/secret/redirect-URI card model; the recommended path is OAuth 2.0 + `offline.access` with on-demand refresh.
