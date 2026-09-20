---
platform: x
topic: errors
sources:
  - https://docs.x.com/x-api/fundamentals/response-codes-and-errors
  - https://docs.x.com/x-api/fundamentals/rate-limits
  - https://docs.x.com/x-api/fundamentals/post-cap
  - https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
  - https://docs.x.com/fundamentals/authentication/faq
  - https://docs.x.com/fundamentals/developer-apps
  - https://docs.x.com/x-api/media/quickstart/media-upload-chunked
  - https://docs.x.com/x-api/media/quickstart/best-practices
  - https://docs.x.com/x-api/media/media-upload-initialize
fetched: 2026-09-19
---

# X — Error reference

suprstar has no X adapter yet (see `overview.md`). Rows marked **(unverified)** are strings widely observed from the X API but not present on the docs.x.com pages fetched on 2026-09-19; rows without that mark quote docs.x.com.

## Error response shape

Source: https://docs.x.com/x-api/fundamentals/response-codes-and-errors

v2 errors are RFC 7807-style problem objects:

```json
{
  "title": "Invalid Request",
  "detail": "The 'query' parameter is required.",
  "type": "https://api.x.com/2/problems/invalid-request"
}
```

- `type` — "URI identifying the error type" (older responses use the `https://api.twitter.com/2/problems/...` host; treat both hosts as equivalent and match on the last path segment)
- `title` — "Short error description"
- `detail` — "Specific explanation for this error"
- `status` — HTTP status (present on many responses)
- `errors[]` — **partial errors**: "Check for `errors` array even in 200 responses when requesting multiple resources" (e.g. one of several `ids` in `GET /2/tweets` was deleted). An adapter must not treat HTTP 200 as fully successful for batch lookups.

OAuth token-endpoint errors use the OAuth 2.0 shape instead: `{"error": "invalid_request", "error_description": "..."}` (unverified verbatim on docs.x.com; standard).

Rate-limit responses may still carry the legacy shape `{"errors":[{"code": 88, "message": "Rate limit exceeded"}]}` — the rate-limits page quotes exactly `"code": 88, "message": "Rate limit exceeded"`.

## HTTP status codes

Source: https://docs.x.com/x-api/fundamentals/response-codes-and-errors (descriptions quoted)

| Status | Doc description | Action |
|---|---|---|
| 200 / 201 / 204 | OK / Created (`POST /2/tweets` returns 201) / No Content | — |
| 400 | "Invalid JSON, malformed query, missing required parameters" | Doc: "Validate JSON syntax, check required parameters, verify parameter types, and properly escape special characters." |
| 401 | "Invalid or missing authentication credentials" | Doc: "Verify correct authentication method, credentials validity, and `Authorization` header format". Refresh or reconnect. |
| 402 | not listed on the docs page | Observed when the credit balance is exhausted (unverified). Buy credits at console.x.com. |
| 403 | "Valid auth but no permission for this resource or action" | Doc: "Confirm app endpoint access, required enrollment status, appropriate OAuth scopes, and resource privacy settings." |
| 404 | "Resource doesn't exist or has been deleted" | Post/media/user id wrong or deleted. |
| 409 | "Stream has no rules (filtered stream only)" | not applicable |
| 429 | "Rate limit or usage cap exceeded" | Doc: "Check `x-rate-limit-reset` header timing, implement exponential backoff, cache responses, and distribute requests across the window." |
| 500 | "Wait and retry; check status page" | retry with backoff |
| 502 | "Wait and retry" | retry |
| 503 | "X is overloaded; wait and retry" | retry |
| 504 | "Wait and retry" | retry |

## Problem `type` URIs

Source: https://docs.x.com/x-api/fundamentals/response-codes-and-errors (list on the page) plus endpoint schemas

| `type` (last segment) | Doc meaning | Likely cause in suprstar |
|---|---|---|
| `about:blank` | "Generic error (see HTTP status code)" | 401 Unauthorized with `detail: "Unauthorized"` is the usual form for expired tokens |
| `invalid-request` | "Malformed request or invalid parameters" | bad JSON, text too long (see below), invalid `media_ids`, wrong `media_category` |
| `resource-not-found` | "Post, user, or other resource doesn't exist" | deleted post in metrics lookup; wrong media id |
| `not-authorized-for-resource` | "No access to private/protected content" | token lacks scope; media belongs to another user; post not owned when requesting `non_public_metrics` |
| `client-forbidden` | "App not enrolled or lacks required access" | app permission "Read only"; endpoint not available on plan (quote posts, replies) |
| `usage-capped` | "Usage cap exceeded" | monthly 3M Post-read cap or credits exhausted (billing page: "API requests will fail until you purchase more credits") |
| `rate-limit-exceeded` | "Rate limit exceeded" | per-endpoint window exhausted |
| `disallowed-resource` | in endpoint schemas (`DisallowedResourceProblem`) | resource blocked/suspended |
| `resource-unavailable` | `ResourceUnavailableProblem` in media schemas | media still processing / expired |
| `unsupported-authentication` (unverified) | app-only bearer used on a user-context endpoint | must use user token |
| `client-not-enrolled` (unverified) | "When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project" | legacy standalone app |
| `oauth1-permissions` (unverified) | "Your client app is not configured with the appropriate oauth1 app permissions for this endpoint" | app permission not Read and write |
| `streaming-connection`, `rule-cap`, `invalid-rules`, `duplicate-rules` | filtered-stream only | not applicable |

## Errors by suprstar operation

### Connect (authorize + token exchange)

Sources: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code , https://docs.x.com/fundamentals/developer-apps

| Error | Meaning | Fix |
|---|---|---|
| Authorize page fails to render / X shows a generic error before consent (wording unverified) | `redirect_uri` not an exact match ("URLs must match exactly (including trailing slashes)"); `localhost` used ("use `http://127.0.0.1` (not `localhost`)"); `client_id` invalid; `code_challenge` missing | fix Redirect URI on card back **and** in console; add PKCE params |
| `invalid_request` — "Value passed for the authorization code was invalid, or expired." (unverified) | code older than "30 seconds", reused, or `code_verifier` mismatch | exchange once, immediately; persist verifier per `state` |
| `invalid_client` (unverified) | wrong Basic header; API Key/Secret used instead of OAuth 2.0 Client ID/Secret; secret regenerated | re-enter OAuth 2.0 Client ID/Secret ("Save credentials immediately—they're only shown once.") |
| `unauthorized_client` (unverified) | app type is Public (Native/SPA) but a secret was sent, or vice versa | set app type "Web App" (confidential) |
| `invalid_scope` (unverified) | scope string contains an unknown scope or comma-separated instead of space-separated | use `tweet.read tweet.write users.read media.write offline.access` |
| Callback arrives with `?error=access_denied` (standard OAuth, unverified) | user pressed Cancel on the consent screen | retry connect |
| suprstar callback: "Missing code or state parameter" | X redirected without `code` (user denied, or wrong redirect target) | see above |

### Test connection / profile (`GET /2/users/me`)

| Error | Meaning | Fix |
|---|---|---|
| 401 `title: "Unauthorized"`, `type: "about:blank"` | access token expired (2 h without refresh), revoked in X settings ("An access token will be invalidated if a user explicitly revokes an application"), or app suspended | refresh; if refresh fails, reconnect |
| 403 `client-forbidden` / `not-authorized-for-resource` | missing `users.read`/`tweet.read`; app not enrolled | reconnect with full scopes |
| 429 | 75 / 15 min per user exceeded — repeated "Test connection" clicks | wait for `x-rate-limit-reset` |
| 402 / `usage-capped` | no credits | buy credits |

### Publish (`POST /2/tweets`, media upload)

Sources: https://docs.x.com/x-api/posts/creation-of-a-post , https://docs.x.com/x-api/media/quickstart/media-upload-chunked , https://docs.x.com/x-api/media/quickstart/best-practices

| Error | Meaning | Fix |
|---|---|---|
| 403 `detail: "You are not allowed to create a Tweet with duplicate content."` (unverified verbatim; legacy code 187 "Status is a duplicate") | same text posted recently by this account | change the caption; do not blind-retry |
| 403 `client-forbidden` / `oauth1-permissions` | app permission is "Read only", or token predates the permission change ("Changing permissions requires users to re-authorize your app") | set Read and write, reconnect |
| 403 `not-authorized-for-resource` on media | `media.write` not granted; media uploaded by a different user | reconnect with `media.write` |
| 403 "This user is not allowed to post a video longer than 20 minutes." | non-Premium user exceeded `tweet_video` default (20 min / 8 GB; Premium 125 min / 16 GB) | shorten/compress |
| 403 quote/reply forbidden (`client-forbidden`, wording unverified) | quote posts Enterprise-only; programmatic replies only when "summoned" (changelog 2026-02-23, 2026-04-16) | remove `quote_tweet_id` / `reply` |
| 400 `invalid-request` — text too long (wording unverified; often `"Your Tweet text is too long."` / legacy code 186) | > 280 weighted characters (emoji = 2, URL = 23) | trim caption |
| 400 `invalid-request` on `media_ids` | media id expired (24 h), still processing, wrong `media_category` ("Using wrong categories (e.g., DM categories on Posts) commonly causes Post creation failures after successful uploads"), or > 4 ids | re-upload with `tweet_image`/`tweet_video`; wait for `succeeded` |
| Upload 400 / 413 (unverified) | image > 5 MB, GIF > 15 MB, chunk > 5 MB, `segment_index` gap | resize; chunk ≤ 5 MB, sequential indexes |
| `processing_info.state: "failed"` | transcoding failed (codec not H.264/AAC-LC, YUV 4:2:0 required, interlaced, aspect outside 1:3–3:1, > 60 fps) | re-encode per `publishing.md` |
| 429 `rate-limit-exceeded` | 100 posts / 15 min per user or 10,000 / 24 h per app; media 500 / 15 min | wait for reset |
| 429 `usage-capped` or 402 | credits exhausted ("API requests will fail until you purchase more credits") | top up at console.x.com |
| 401 | token expired mid-flow (uploads + processing can exceed the 2-hour window on long videos) | refresh before publish |
| 500 / 502 / 503 / 504 | transient | retry with backoff; media upload sessions survive (re-APPEND the failed segment) |

### Metrics (`GET /2/tweets`, `GET /2/users/me`)

| Error | Meaning | Fix |
|---|---|---|
| 200 with `errors[]` (`resource-not-found`) | one of the requested post ids was deleted | drop the id, treat the rest as valid |
| 403 `not-authorized-for-resource` on `non_public_metrics`/`organic_metrics` | post not owned by the token's user, or app-only auth | request only `public_metrics` for foreign posts; use user token |
| 429 | 5,000 / 15 min per user (`GET /2/tweets`), 75 / 15 min (`/2/users/me`) | space out snapshots |
| `usage-capped` | 3M Post reads / month | reduce polling |

## Rate-limit headers and backoff

Source: https://docs.x.com/x-api/fundamentals/rate-limits

Every response carries, per 15-minute window:

- `x-rate-limit-limit` — "Maximum requests allowed"
- `x-rate-limit-remaining` — "Requests remaining in window"
- `x-rate-limit-reset` — "Unix timestamp when window resets" (epoch seconds)

24-hour limits (`POST /2/tweets` 10,000 / 24 h per app; media 50,000 / 24 h per app) are enforced but the corresponding headers `x-user-limit-24hour-limit`, `x-user-limit-24hour-remaining`, `x-user-limit-24hour-reset` and `x-app-limit-24hour-*` are **not documented on the current rate-limits page** — unverified; parse them if present.

Recommended handling (doc guidance plus adapter policy):

1. On 429: read `x-rate-limit-reset`, sleep until that epoch (+1 s jitter), then retry once. Doc: "checking the reset header, waiting until that timestamp, then retrying—optionally using exponential backoff."
2. Treat `usage-capped` / 402 as **non-retryable**: surface "X credits exhausted — top up at console.x.com".
3. Treat 403 duplicate-content and 400 `invalid-request` as non-retryable; suprstar's job should fail with the `detail` string so the user can edit the post.
4. Retry 5xx with exponential backoff (1 s, 2 s, 4 s, max 3 attempts).
5. Before publishing, if `x-rate-limit-remaining` from the last call was 0 for `POST /2/tweets`, defer the job to `x-rate-limit-reset`.
6. "Rate limits and billing are separate" — a request can be within rate limits and still fail on credits, or be rate-limited without being charged.

## Reading errors in suprstar today

Once an adapter exists it should follow the other adapters' convention: throw `PlatformError("x", detail || title || \`X request failed (${status})\`, status)`. The publisher stores that message on the job (`status: "failed"`, visible on the post), and the OAuth callback forwards it to `/connections?error=<message>`. The agent should therefore search this file by the `detail`/`title` text and by the HTTP status in parentheses.
