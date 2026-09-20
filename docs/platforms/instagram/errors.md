---
platform: instagram
topic: errors
sources:
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes
  - https://developers.facebook.com/docs/graph-api/guides/error-handling
  - https://developers.facebook.com/docs/graph-api/overview/rate-limiting
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/insights
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
fetched: 2026-09-19
---

# Instagram / Graph API errors relevant to suprstar

## Error response shape

Source: https://developers.facebook.com/docs/graph-api/guides/error-handling

```json
{
  "error": {
    "message": "A human-readable description of the error",
    "type": "OAuthException",
    "code": 190,
    "error_subcode": 463,
    "error_user_title": "The title of the dialog, if shown",
    "error_user_msg": "The message to display to the user",
    "fbtrace_id": "Internal support identifier"
  }
}
```

suprstar surfaces only `error.message` (as `PlatformError.message`, HTTP status in `PlatformError.status`). The `code` / `error_subcode` are not stored, so to map a failure precisely, reproduce the call with the same token (Graph API Explorer or curl) or match the message text below. Publish failures are recorded on the publish job (`status: "failed"`, message) and post status becomes `failed` / `partially_published`.

## Where each call can fail

| suprstar action | Graph calls | App-level messages on failure |
|---|---|---|
| Connect (OAuth callback) | `GET /oauth/access_token`, `GET /me/accounts`, `GET /{ig-user-id}` | `Instagram token exchange failed (<status>)`, `Instagram page lookup failed (<status>)`, `No Facebook Page with a linked Instagram Business account was found.`, `Instagram profile fetch failed (<status>)`, `Missing code or state parameter`, `Unknown connection`; all shown as `/connections?error=...` |
| Test connection | `GET /me/accounts`, `GET /{ig-user-id}` | same as above; result stored in `lastTest`, status set to `error` if previously connected |
| Refresh token | `GET /oauth/access_token?grant_type=fb_exchange_token` | `Instagram token refresh failed (<status>)` or Graph `error.message` |
| Publish | `GET /me/accounts` (if no IG user id saved), `POST /{ig-user-id}/media`, `GET /{container}?fields=status_code`, `POST /{ig-user-id}/media_publish` | `Instagram posts require at least one media file.`, `Instagram media creation failed (<status>)`, `Instagram media container failed to process.`, `Timed out waiting for Instagram media container to finish processing.`, `Instagram publish failed (<status>)` |
| Metrics | `GET /{ig-user-id}/insights` | never fails visibly; adapter returns `[]` |

## Auth and permission errors

Source: https://developers.facebook.com/docs/graph-api/guides/error-handling

| Code | Subcode | Type / message (exact where documented) | Meaning | Fix |
|---|---|---|---|---|
| `190` | none | `OAuthException` | Access token invalid or expired | "Get a new access token": reconnect, then press Refresh token |
| `190` | `463` | "Error validating access token: Session has expired on ..." (message wording standard, subcode verified) | Token expired (short-lived after ~1-2 h, long-lived after ~60 d) | Reconnect; refresh within the hour; schedule refresh before day 60 |
| `190` | `467` | Invalid Access Token | Session invalidated | Reconnect |
| `190` | `460` | Password Changed | User changed Facebook password | Reconnect |
| `190` | `458` | App Not Installed | User deauthorized the app (revoked access) | Reconnect (user must re-grant) |
| `190` | `459` | User Checkpointed | Account needs action on facebook.com | User logs in at facebook.com, clears checkpoint, reconnect |
| `190` | `464` | Unconfirmed User | Facebook account not confirmed | Confirm account, reconnect |
| `190` | `492` | Invalid Session | "User lacks appropriate Page role" | Grant the Facebook user a role on the linked Page; reconnect |
| `102` | | API Session | Same handling as `OAuthException` | Reconnect |
| `10` | | "(#10) Application does not have permission for this action" (standard wording) / API Permission Denied | Missing permission or not approved for this user | Check scopes on card back; `debug_token` to see granted `scopes`; App Review / role user |
| `200`-`299` | | API Permission | Permission missing; e.g. `200` "The calling app is missing the ads_management..." (403) when the user's Page role comes from Business Manager | Add `ads_management`/`ads_read` (needs App Review) or assign a direct Page role |
| `3` | | API Method | "Make sure your app has the necessary capability or permissions" | Add the product/permission in App Dashboard |
| `100` | `33` | "Unsupported get request. Object with ID '...' does not exist, cannot be loaded due to missing permissions, or does not support this operation" (standard wording, subcode listed in Meta guide as object-not-found; exact text unverified) | Wrong IG user id / container id, or token cannot see it | Clear or correct the card-back Instagram business account ID; make sure the token's user has a role on the Page |
| `100` | | Invalid parameter (generic) | Bad parameter, invalid metric (e.g. `impressions` on v22.0+), invalid `media_type` | Correct the request |
| `1` | | API Unknown | "Wait and retry the operation" | Retry with backoff |
| `2` | | API Service | "Temporary issue due to downtime. Wait and retry" | Retry with backoff |
| `368` | | Policy Violation Block | Temporarily blocked | "Wait and retry the operation" |
| `506` | | Duplicate Post | Identical content posted recently | "Change the content of the post and try again" |
| `1609005` | | Error Posting Link | Bad URL in content | "Check the URL and try again" |

## Rate-limit errors and headers

Source: https://developers.facebook.com/docs/graph-api/overview/rate-limiting

| Code | Meaning | Scope |
|---|---|---|
| `4` | "App reached rate limit" (API Too Many Calls) | Platform limit: `200 * Number of Users` per hour, per app |
| `17` | "User reached rate limit" (API User Too Many Calls) | Platform limit, per user |
| `32` | Pages API limit reached | Pages |
| `613` | Custom rate limit exceeded | Endpoint-specific |
| `80001` | Page/system-user token limit (BUC) | Business Use Case, Pages/Instagram |
| `4` / subcode `2207051` | "We restrict certain activity to protect our community." | Publishing throttled as suspected spam |
| `9` / subcode `2207042` | "You reached maximum number of posts that is allowed..." | Publishing quota (`content_publishing_limit`) |
| `341` | Application Limit Reached | Wait and retry |

Instagram Platform BUC quota: `4800 * Impressions` calls per 24 h per app-user. Headers to read on every response:

- `X-App-Usage`: JSON `{"call_count": <% of hourly quota>, "total_cputime": <%>, "total_time": <%>}`.
- `X-Business-Use-Case-Usage`: JSON keyed by business id with `call_count`, `total_cputime`, `total_time`, `estimated_time_to_regain_access` (minutes), `type` (e.g. `instagram`, `pages`), `ads_api_access_tier`.

Backoff guidance from Meta: "When the limit has been reached, stop making API calls. Continuing to make calls will continue to increase your call count, which will increase the time before calls will be successful again." Use `estimated_time_to_regain_access` as the minimum wait; otherwise back off exponentially (e.g. 1, 2, 4, 8 min) and spread calls evenly. suprstar has no automatic retry; a rate-limited publish job is marked failed and must be re-run manually after the wait.

## Content publishing errors

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes (all rows verified on that page unless marked)

| HTTP | Code | Subcode | Message (exact, truncated as on the page) | Meaning / fix |
|---|---|---|---|---|
| 400 | `-2` | `2207003` | "It takes too long to download the media." | Meta timed out fetching the suprstar media URL; serve smaller/faster media, retry |
| 400 | `-2` | `2207020` | "The media you are trying to access has expired." | Container older than 24 h; create a new one (suprstar always does on retry) |
| 400 | `-1` | `2207001` | (no message) | Instagram server error; retry |
| 400 | `-1` | `2207032` | "Create media fail, please try to re-create media" | Retry container creation |
| 400 | `-1` | `2207053` | "unknown upload error" | Generate a new container (video) |
| 400 | `1` | `2207057` | "Thumbnail offset must be greater than or equal to 0..." | `thumb_offset` outside video duration |
| 400 | `4` | `2207051` | "We restrict certain activity to protect our community." | Publishing flagged as spam; slow down, vary content |
| 400 | `9` | `2207042` | "You reached maximum number of posts that is allowed..." | Daily quota reached; retry next day |
| 400 | `24` | `2207006` | "The media with {media-id} cannot be found" | Permission/token issue or wrong id; new container |
| 400 | `24` | `2207008` | "The media builder with creation id...does not exist..." | Container expired or wrong `creation_id`; Meta says "retry within 30 seconds to 2 minutes" |
| 400 | `25` | `2207050` | "The Instagram account is restricted." | Account restricted from publishing; user must resolve in the Instagram app |
| 400 | `100` | `2207023` | "The media type {media-type} is unknown." | Invalid `media_type`; use `REELS`, `STORIES`, `CAROUSEL` |
| 400 | `100` | `2207028` | "Your post won't work as a carousel..." | Carousel needs 2-10 items |
| 400 | `100` | `2207035` | "Product tag positions should not be specified for..." | Remove x/y from video product tags |
| 400 | `100` | `2207036` | "Product tag positions are required for photo media." | Add x/y |
| 400 | `100` | `2207037` | "We couldn't add all of your product tags..." | Invalid products |
| 400 | `100` | `2207040` | "Cannot use more than {max-tag-count} tags per..." | Max 20 @tags |
| 400 | `352` | `2207026` | "The video format is not supported." | Use MP4/MOV, H.264/HEVC, AAC, moov atom first, no edit lists |
| 400 | `9004` | `2207052` | "The media could not be fetched from this uri:" | suprstar media URL not publicly reachable (localhost, auth, redirect, wrong content type, firewall) |
| 400 | `9007` | `2207027` | "The media is not ready for publishing..." | Container not `FINISHED`; poll status, publish later |
| 400 | `36000` | `2207004` | "The image is too large to download..." | Image over 8 MiB |
| 400 | `36001` | `2207005` | "The image format {current-format} is not supported." | JPEG only |
| 400 | `36003` | `2207009` | "The submitted image with aspect ratio..." | Keep 4:5 to 1.91:1 (9:16 images rejected) |
| 400 | `36004` | `2207010` | "The submitted image's caption was..." | Caption over 2200 characters |
| 403 | `200` | none | "The calling app is missing the ads_management..." | Request `ads_management` or use a direct Page role |

Codes seen in older Meta docs but not on the current page (unverified): `2207009` listed above is verified; `36002` (image too small / resolution) and `2207024` ("media ID is not available") were not present on the fetched page; treat them as legacy.

When `status_code` is `ERROR`, the container's `status` field "contains an error subcode rather than descriptive text": look the subcode up in this table (for example `2207026` = unsupported video format).

## Insights errors

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/insights and ig-user/insights

| Code | Message | Meaning |
|---|---|---|
| `10` | "Not enough viewers for the media to show insights" | Story with fewer than 5 views |
| `100` | invalid metric (e.g. `impressions` after v22.0 / April 21, 2025) | Request `views` with `metric_type=total_value` instead |
| `100` | metric not available | `follower_count` / `online_followers` need at least 100 followers; story metrics only for 24 h; album children have no insights |

## suprstar-side error strings (not from Meta)

| String | Raised when |
|---|---|
| `Instagram posts require at least one media file.` | Post targeted Instagram with no media |
| `No Facebook Page with a linked Instagram Business account was found.` | `/me/accounts` returned no Page with `instagram_business_account` |
| `Instagram media container failed to process.` | `status_code` became `ERROR` during the 20 s poll |
| `Timed out waiting for Instagram media container to finish processing.` | 20 polls (about 20 s) without `FINISHED` |
| `Instagram media creation failed (<status>)` / `Instagram publish failed (<status>)` / `Instagram page lookup failed (<status>)` / `Instagram profile fetch failed (<status>)` / `Instagram token exchange failed (<status>)` / `Instagram token refresh failed (<status>)` | Non-2xx with no parseable `error.message` |
| `Missing code or state parameter`, `Unknown connection` | OAuth callback without code/state, or state pointing at a deleted connection |
| `Sandbox connection is missing credentials or a valid token` | Sandbox test with empty Client ID/secret/redirect or expired fake token |
