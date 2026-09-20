---
platform: youtube
topic: errors
sources:
  - https://developers.google.com/youtube/v3/docs/errors
  - https://developers.google.com/youtube/v3/docs/videos/insert
  - https://developers.google.com/youtube/v3/docs/videos/list
  - https://developers.google.com/youtube/v3/docs/channels/list
  - https://developers.google.com/youtube/v3/docs/videos
  - https://developers.google.com/identity/protocols/oauth2/web-server
  - https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
  - https://developers.google.com/youtube/v3/determine_quota_cost
  - https://developers.google.com/youtube/analytics/reference/reports/query
fetched: 2026-09-19
---

# YouTube: error reference for suprstar

## How errors reach suprstar

Data API errors are JSON:

```json
{"error":{"code":403,"message":"The request cannot be completed because you have exceeded your quota.",
  "errors":[{"message":"...","domain":"youtube.quota","reason":"quotaExceeded"}]}}
```

The adapter throws `PlatformError("youtube", data.error.message || "YouTube ... failed (<status>)", status)`. So the text shown in the app is Google's `error.message`; the `reason` code is not surfaced, but the message strings below map one-to-one to reasons. OAuth token-endpoint errors are `{"error":"invalid_grant","error_description":"..."}` and the app shows `error_description` (or `error`).

Suprstar call -> API method: **connect** = token exchange + `channels.list`; **test** = `channels.list?part=snippet,statistics&mine=true`; **publish** = `videos.insert` multipart; **refresh** = token endpoint `grant_type=refresh_token`; **metrics** = (future) Analytics `reports.query`.

## OAuth / token errors

Source: https://developers.google.com/identity/protocols/oauth2/web-server

| HTTP | `error` | Seen on | Meaning | Fix |
|---|---|---|---|---|
| 400 | `redirect_uri_mismatch` | connect | "Provided redirect_uri doesn't match registered URIs" | Register the exact card-back Redirect URI on the OAuth client. |
| 400/401 | `invalid_client` | connect, refresh | "OAuth client secret incorrect" or unknown client_id | Re-enter Client ID/secret; confirm the client belongs to the project with YouTube Data API enabled. |
| 400 | `invalid_grant` | connect | Authorization code invalid, expired, or already redeemed | Retry Connect once; make sure the callback is not hit twice. |
| 400 | `invalid_grant` | refresh | "Token expired or invalidated; re-authenticate user" (revoked, 7-day Testing expiry, 6 months unused, >50 tokens) | Reconnect the profile; publish the consent screen if in Testing. |
| 400 | `invalid_request` | connect | Malformed request / missing parameter | Check scope formatting and that `code` was present. |
| 400 | `unauthorized_client` | connect | Client not allowed to use this grant | Use a Web application OAuth client. |
| 400 | `deleted_client` | connect | "OAuth client has been deleted" | Create a new client. |
| n/a | `access_denied` (query param) | connect | User cancelled or not a test user | Add as test user or publish app; retry. |
| n/a | `admin_policy_enforced` | connect | Workspace policy blocks scopes | Admin allow-list the app. |
| n/a | `org_internal` | connect | Client is Internal-only | Use org account or switch consent screen to External. |
| n/a | `disallowed_useragent` | connect | Embedded webview | Use a normal browser. |

## Data API errors likely on test / connect (`channels.list`)

Sources: https://developers.google.com/youtube/v3/docs/errors, https://developers.google.com/youtube/v3/docs/channels/list

| HTTP | reason | message | Fix |
|---|---|---|---|
| 401 | `authorizationRequired` | "The request uses the `mine` parameter but is not properly authorized." | Token expired/missing: Refresh token or reconnect. |
| 401 | `youtubeSignupRequired` | "The user has an unlinked Google Account without a YouTube channel." | Create a channel for the account, reconnect. |
| 401 | (generic) `authError` / "Invalid Credentials" (**unverified** exact text) | Access token invalid | Refresh token or reconnect. |
| 403 | `forbidden` | "Access forbidden. The request may not be properly authorized." | Check scopes granted; reconnect. |
| 403 | `insufficientPermissions` | "The OAuth 2.0 token provided specifies scopes insufficient for accessing the requested data." | Tick `youtube.readonly` on the card back and reconnect. |
| 403 | `quotaExceeded` | "The request cannot be completed because you have exceeded your quota." | Wait for midnight PT reset or request quota extension. |
| 403 | `channelForbidden` | Channel doesn't support the request or authorization insufficient | Wrong account / scope. |
| 403 | `authenticatedUserAccountClosed` / `authenticatedUserAccountSuspended` | "The YouTube account of the authenticated user is closed/suspended." | Account issue on YouTube side. |
| 400 | `invalidMine` | "The request's use of the `mine` parameter is not supported." | Token is not a user token (e.g. service account). |
| 400 | `invalidCriteria` | "A maximum of one of the following filters may be specified: `id`, `categoryId`, `mine`, `managedByMe`, `forHandle`, `forUsername`" | Adapter bug (not expected). |
| app | n/a | "No YouTube channel found for this account." | `items` empty: account has no channel or wrong account chosen. |

## Data API errors on publish (`videos.insert`)

Sources: https://developers.google.com/youtube/v3/docs/videos/insert, https://developers.google.com/youtube/v3/docs/errors

| HTTP | reason | message (verbatim) | Fix |
|---|---|---|---|
| 400 | `invalidTitle` | "The request metadata specifies an invalid or empty video title." | Give the post a title; remove `<`/`>`; max 100 chars. |
| 400 | `invalidDescription` | "The request metadata specifies an invalid video description." | Remove `<`/`>`; keep under 5000 bytes. |
| 400 | `invalidCategoryId` | "The snippet.categoryId property specifies an invalid category ID." | Set card-back Category to a valid numeric ID (e.g. 22). |
| 400 | `invalidTags` | "The request metadata specifies invalid video keywords." | n/a (suprstar sends no tags). |
| 400 | `invalidVideoMetadata` | "The request metadata is invalid." | Check JSON part of multipart body. |
| 400 | `mediaBodyRequired` | "The request does not include the video content." | Video part missing or zero bytes; check the media file exists on disk. |
| 400 | `invalidFilename` | "The video filename specified in the Slug header is invalid." | n/a (no Slug header sent). |
| 400 | `invalidPublishAt` | "The request metadata specifies an invalid scheduled publishing time." | n/a. |
| 400 | `uploadLimitExceeded` | "The user has exceeded the number of videos they may upload." / "The channel's daily video upload limit has been reached." | Wait 24 h; verify the channel by phone for higher limits. |
| 400 | `defaultLanguageNotSet` | "The request is trying to add localized video details without specifying the default language." | n/a. |
| 401 | `authorizationRequired` / expired token | see above | Refresh token or reconnect. |
| 403 | `forbidden` | (no additional description) | Typical causes: token lacks `youtube.upload`; channel cannot upload; API disabled. |
| 403 | `forbiddenPrivacySetting` | "The request attempts to set an invalid privacy setting for the video." | Use `public`, `private` or `unlisted`; note `friends` -> `unlisted` mapping. |
| 403 | `forbiddenLicenseSetting` | "The request attempts to set an invalid license for the video." | n/a. |
| 403 | `quotaExceeded` | "The request cannot be completed because you have exceeded your quota." | 100 uploads/day bucket or 10,000 units exhausted; wait for PT midnight. |
| 403 | `insufficientPermissions` | "The OAuth 2.0 token provided specifies scopes insufficient for accessing the requested data." | Grant `youtube.upload`. |
| 403 | `channelClosed` / `channelSuspended` | "The channel identified in the request has been closed/suspended." | Channel-side action required. |
| 413 | (**unverified**) | Request entity too large | File over 256GB or proxy limit; use resumable upload. |
| 429 | `uploadRateLimitExceeded` | "The channel has uploaded too many thumbnails recently." (listed under video errors) | Back off. |
| 500/502/503/504 | `backendError` (**unverified** reason) | Transient | Retry with exponential backoff; use resumable upload to avoid re-sending the whole file. |
| app | n/a | "YouTube requires a video file to publish." | Attach a video, not an image. |

Post-upload states (not surfaced by suprstar, visible via `videos.list?part=status,processingDetails`):

| Field | Values | Meaning |
|---|---|---|
| `status.uploadStatus` | `uploaded`, `processed`, `failed`, `rejected`, `deleted` | `uploaded` = still processing |
| `status.failureReason` | `codec`, `conversion`, `emptyFile`, `invalidFile`, `tooSmall`, `uploadAborted` | Re-encode (H.264/AAC MP4) and re-upload |
| `status.rejectionReason` | `claim`, `copyright`, `duplicate`, `inappropriate`, `legal`, `length`, `termsOfUse`, `trademark`, `uploaderAccountClosed`, `uploaderAccountSuspended` | `duplicate`: file already on the channel; `length`: exceeds channel's limit |
| `processingDetails.processingStatus` | `processing`, `succeeded`, `failed`, `terminated` | poll until `succeeded` |
| `processingDetails.processingFailureReason` | `other`, `streamingFailed`, `transcodeFailed`, `uploadFailed` | re-upload |

## Metrics errors (Analytics API, for when `fetchMetrics` is implemented)

Source: https://developers.google.com/youtube/analytics/reference/reports/query

| HTTP | reason / message | Fix |
|---|---|---|
| 400 | `badRequest` (invalid `metrics`/`dimensions` combination, bad `ids`, dates) | Use `ids=channel==MINE`, `dimensions=day`, valid metric names. |
| 401 | token expired | Refresh/reconnect. |
| 403 | `forbidden` / insufficient scope | Token must include `yt-analytics.readonly`; user must own the channel. |
| 403 | `accessNotConfigured` (**unverified** exact string) | Enable YouTube Analytics API in the Cloud project. |

## Rate limits, quota headers and backoff

Sources: https://developers.google.com/youtube/v3/determine_quota_cost, https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol, https://developers.google.com/youtube/v3/docs/errors

- YouTube does **not** return remaining-quota headers on Data API responses; usage is only visible in Google Cloud console > APIs & Services > YouTube Data API v3 > Quotas. (Absence of headers: **unverified** as a documented statement, but no header is documented on the fetched pages.)
- Quota buckets (since 2026-06-01): `videos.insert` 100 calls/day; `search.list` 100 calls/day; everything else 10,000 units/day. Reset "at midnight Pacific Time (PT)". Invalid requests still cost at least 1 unit.
- Signals of exhaustion: `403 quotaExceeded` (daily), `429 tooManyRequests` (`uploadRateLimitExceeded`, short-term burst).
- Backoff guidance from Google for uploads: "Use an exponential backoff strategy when resuming uploads after receiving" HTTP 500, 502, 503 or 504. A practical schedule: 1 s, 2 s, 4 s, 8 s, 16 s (+ jitter), max 5 tries; do not retry `4xx` except `429` and `401`-after-refresh.
- `quotaExceeded` is not retryable within the day; suprstar should mark the job failed and surface the reset time (next 00:00 PT) rather than retry.
- Do not retry `invalid_grant`; it requires a new user authorization.
