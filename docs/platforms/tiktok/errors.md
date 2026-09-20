---
platform: tiktok
topic: errors
sources:
  - https://developers.tiktok.com/doc/oauth-error-handling
  - https://developers.tiktok.com/doc/oauth-user-access-token-management
  - https://developers.tiktok.com/doc/tiktok-api-v2-error-handling
  - https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
  - https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
  - https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
  - https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
  - https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
  - https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit
  - https://developers.tiktok.com/doc/content-sharing-guidelines
fetched: 2026-09-19
---

# TikTok: error reference for suprstar

## Response shapes

Source: https://developers.tiktok.com/doc/oauth-error-handling, https://developers.tiktok.com/doc/tiktok-api-v2-error-handling

Two different shapes exist, and suprstar reads both:

1. OAuth endpoints (`/v2/oauth/token/`, authorize redirect): top-level `error` ("The error category in string."), `error_description` ("The detailed error description."), `log_id` ("The unique ID associated with every request for debugging purposes."). suprstar shows `error_description || error`.
2. All other v2 endpoints: `{"data": {...}, "error": {"code": "<string>", "message": "<text>", "log_id": "<id>"}}`. Success is `error.code == "ok"` with an empty message. suprstar shows `error.message`, and treats any `error.code` other than `ok` as failure even on HTTP 200.

Always capture `log_id` in support tickets.

## Connect (OAuth) errors

Source: https://developers.tiktok.com/doc/oauth-error-handling, https://developers.tiktok.com/doc/oauth-user-access-token-management

| Where | `error` | Official description | Recommended fix |
|---|---|---|---|
| Authorize redirect / token | `access_denied` | "The resource owner or authorization server denied the request." | User cancelled or account ineligible; retry. For a TikTok Sandbox client, add the account as a target user |
| Token | `invalid_client` | "Client authentication failed (for example, unknown client, no client authentication included, or unsupported authentication method)." | Client ID/secret on the card back do not match the TT4D app; re-copy both from the same app (sandbox vs production) |
| Token | `invalid_grant` | "The provided authorization grant ... or refresh token is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client." | Reconnect. Refresh token >365 days old, user revoked access, or code already used |
| Token / authorize | `invalid_request` | "The request misses a required parameter or is otherwise malformed." Examples: "Redirect_uri is not matched with the uri when requesting code."; "The request parameters are malformed." | Fix Redirect URI (exact match, HTTPS, no query/fragment) |
| Authorize | `invalid_scope` | "The requested scope is invalid, unknown, or malformed." | Untick scopes the TT4D app is not approved for |
| Authorize | `unauthorized_client` | "The client is not authorized to request an authorization code using this method." | Add Login Kit + web redirect URI to the app |
| Token | `unsupported_grant_type` | "The authorization grant type is not supported by the authorization server." | Adapter bug; not expected |
| Authorize | `unsupported_response_type` | "The authorization server does not support obtaining an authorization code using this method." | Adapter bug; not expected |
| Any | `server_error` | "Other internal server errors." | Retry with backoff |
| Any | `temporarily_unavailable` | "Service is temporarily unavailable." | Retry with backoff |
| suprstar callback | `Missing code or state parameter` | suprstar string: callback reached without `code`/`state` (user landed on the URL directly, or TikTok returned `error` instead of `code`) | Retry connect; check `error_description` in the redirect |
| suprstar callback | `Unknown connection` | suprstar string: `state` decoded to a connection id that no longer exists | Reconnect from the current profile card |

## Test connection / profile errors (`GET /v2/user/info/`)

Source: https://developers.tiktok.com/doc/tiktok-api-v2-error-handling, https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit

| HTTP | `error.code` | Official message | Meaning in suprstar | Fix |
|---|---|---|---|---|
| 200 | `ok` | "" | Test passes; profile updated | - |
| 401 | `access_token_invalid` | "The access token is invalid or not found in the request." | Token expired (24 h), revoked, or empty because the connection was never completed | **Refresh token**; if that fails, reconnect |
| 401 | `scope_not_authorized` | "The user did not authorize the scope required for completing this request." | `user.info.basic` not granted | Reconnect and accept scopes |
| 400 | `scope_permission_missed` | "Access token is invalid, some fields need additional scopes." | `follower_count` requested without `user.info.stats` | Tick `user.info.stats` on the card back and reconnect (or stop requesting stats fields) |
| 400 | `invalid_params` | "One or more fields in request is invalid." | Bad `fields` list | Adapter bug; not expected |
| 429 | `rate_limit_exceeded` | "The API rate limit was exceeded." | More than 600 req/min on the client | Wait a minute; do not auto-retry tests in a loop |
| 500 | `internal_error` | "This is the generic error code for TikTok internal errors." | TikTok outage | Retry later |

## Publish errors (`/v2/post/publish/video/init/`, `/v2/post/publish/content/init/`)

Source: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post, https://developers.tiktok.com/doc/content-posting-api-reference-photo-post, https://developers.tiktok.com/doc/content-posting-api-reference-upload-video, https://developers.tiktok.com/doc/content-sharing-guidelines

| HTTP | `error.code` | Official description | Likely cause in suprstar | Fix |
|---|---|---|---|---|
| 400 | `invalid_param` | "Check error message for details" | Photo post missing `privacy_level`; photo `title` > 90 runes; video `title` > 2200 runes; malformed URL; unsupported format | Read `error.message`; shorten caption; engineering: add `privacy_level` to photo posts |
| 400 | `app_version_check_failed` (photos) | User's TikTok app "version < 31.8" | Creator's TikTok app is outdated | Ask creator to update the TikTok app |
| 401 | `access_token_invalid` | "The access_token for the TikTok user is invalid or has expired" | 24 h token expired; suprstar does not auto-refresh | **Refresh token**, then republish |
| 401 | `scope_not_authorized` | "The access_token does not bear user's grant on `video.publish` scope." | User unticked `video.publish` at consent, or scope not approved on the app | Reconnect with `video.publish`; confirm Content Posting API + Direct Post enabled |
| 403 | `spam_risk_too_many_posts` | "The daily post cap from the API is reached for the current user." | ~15 posts/creator/24 h reached | Wait until the window rolls; reschedule |
| 403 | `spam_risk_user_banned_from_posting` | "The user is banned from making new posts." | Account restricted by TikTok | Creator must resolve with TikTok; nothing to fix in suprstar |
| 403 | `spam_risk_too_many_pending_share` | "There may be at most 5 pending shares within any 24-hour period" | Inbox/`MEDIA_UPLOAD` drafts not completed | Creator completes or discards drafts in the TikTok inbox |
| 403 | `reached_active_user_cap` | "The daily quota for active publishing users from your client is reached." | Unaudited client already had 5 distinct users post today | Wait 24 h or pass audit |
| 403 | `unaudited_client_can_only_post_to_private_accounts` | Unaudited clients restricted | `privacy_level` other than `SELF_ONLY`, or the creator's account is public while the client is unaudited | Set the TikTok account to private, keep `SELF_ONLY`, or complete audit |
| 403 | `url_ownership_unverified` | URL ownership not verified | Media URL host (suprstar's public origin) is not a verified domain/prefix, or is `localhost`/http | Verify the domain in TT4D **Manage URL properties**; make sure the app's public origin is HTTPS and reachable |
| 403 | `privacy_level_option_mismatch` | `privacy_level` invalid for this creator | Value not in `privacy_level_options` (e.g. `PUBLIC_TO_EVERYONE` on a private account) | Use `SELF_ONLY`, or call `creator_info/query` and pick from the returned options |
| 429 | `rate_limit_exceeded` | "Your request is blocked due to exceeding the API rate limit" | More than 6 init calls/min per user token (bulk scheduling) | Space TikTok publishes at least 10 s apart per account |
| 5xx | `internal_error` | Server/network error | TikTok side | Retry with backoff |

suprstar-side publish errors (before any HTTP call): `TikTok posts require at least one media file.`

## Post status errors (`/v2/post/publish/status/fetch/`)

Source: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status

| HTTP | `error.code` | Meaning | Fix |
|---|---|---|---|
| 400 | `invalid_publish_id` | Non-existent `publish_id` | Use the `publish_id` returned by init (suprstar stores it as `externalId`) |
| 400 | `token_not_authorized_for_specified_publish_id` | `publish_id` belongs to a different user token | Query with the same account's token |
| 401 | `access_token_invalid` | Expired/invalid token | Refresh token |
| 401 | `scope_not_authorized` | Missing `video.publish`/`video.upload` | Reconnect |
| 429 | `rate_limit_exceeded` | > 30 req/min per token | Slow polling |
| 5xx | `internal_error` | Server error | Retry |

Terminal `status: "FAILED"` carries a `fail_reason` string (values are not enumerated in the official docs; treat as free text, unverified list). Typical causes for `PULL_FROM_URL`: URL unreachable within the hour, redirect, unsupported codec/frame rate/resolution.

## Creator info errors (`/v2/post/publish/creator_info/query/`)

Source: https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info

Note these come back with HTTP 200 and a non-`ok` code: `spam_risk_too_many_posts` ("The daily post cap from the API is reached for the current user."), `spam_risk_user_banned_from_posting` ("The user is banned from making new posts."), `reached_active_user_cap` ("The daily quota for active publishing users from your client is reached."). Also 401 `access_token_invalid` ("The access_token is invalid or has expired."), 401 `scope_not_authorized` ("The access_token does not bear user's grant on `video.publish` scope."), 429 `rate_limit_exceeded` ("Your request is blocked due to exceeding the API rate limit.").

## Metrics errors

suprstar does not call any TikTok metrics endpoint (`fetchMetrics` returns `[]`), so "metrics empty" on a live TikTok connection is expected behaviour, not an API error. If per-video counters are added later via `/v2/video/list/` or `/v2/video/query/` (scope `video.list`, 600 req/min), the same generic table applies: `access_token_invalid`, `scope_not_authorized`, `invalid_params`, `rate_limit_exceeded`, `internal_error`.

## Rate limits and backoff

Source: https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit and the per-endpoint pages above

- Breach response: HTTP `429`, `error.code` `rate_limit_exceeded`. Window: "one minute sliding window".
- No rate-limit or `Retry-After` headers are documented; do not rely on headers.
- Per-user-token limits: init endpoints 6/min, creator info 20/min, status 30/min. Per-client defaults for Display/User Info: 600/min.
- Backoff guidance (suprstar policy, not TikTok-specified): on 429 wait 60 s before the first retry, then exponential (60, 120, 240 s) with jitter, max 3 retries; never retry `4xx` other than 429; retry `5xx`/`internal_error`/`server_error`/`temporarily_unavailable` with exponential backoff starting at 2 s, max 5 attempts. Publishing is not idempotent: a retried init after a timeout can create a duplicate post, so only retry init when the previous call returned a definite error.
