---
platform: youtube
topic: troubleshooting
sources:
  - https://developers.google.com/identity/protocols/oauth2/web-server
  - https://developers.google.com/identity/protocols/oauth2
  - https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
  - https://developers.google.com/youtube/v3/docs/errors
  - https://developers.google.com/youtube/v3/docs/videos/insert
  - https://developers.google.com/youtube/v3/docs/videos
  - https://developers.google.com/youtube/v3/guides/implementation/videos
  - https://developers.google.com/youtube/v3/revision_history
  - https://developers.google.com/youtube/v3/determine_quota_cost
  - https://developers.google.com/youtube/analytics/reference/reports/query
fetched: 2026-09-19
---

# YouTube: troubleshooting checklist for suprstar

Where to look in suprstar: **Connections page > YouTube profile card > flip to card back**. Sections: Account (Label), API credentials (Client ID, Client secret, Redirect URI with suggested value and copy button, Scopes checkboxes), Mode (Sandbox / Live), Default post settings (Default format, Privacy, Made for kids, Category), Token status (expiry, **Refresh token** button), plus **Test connection** and **Connect / Disconnect** on the card. Server logs come from the `publisher` logger (`Publishing post ... to youtube`, `Failed to publish ...`).

First question for every symptom: is **Mode = Sandbox**? Sandbox never calls Google; every result is simulated, so real-world symptoms only apply to Live.

## Connect button loops back / lands on /connections?error=...

Likely causes:

1. `redirect_uri_mismatch`: the card-back Redirect URI is not registered on the Google OAuth client, or differs by scheme/port/path.
2. `access_denied`: consent screen in Testing and the Google account is not a test user, or the user cancelled.
3. `invalid_client`: Client ID/secret typo, or the client is not a Web application type.
4. Callback error "Missing code or state parameter": Google redirected with `?error=` instead of `?code=`.
5. "No YouTube channel found for this account.": the token exchange worked but `channels.list?mine=true` returned nothing.
6. Consent screen shows "Google hasn't verified this app" and the user backed out.

What to check in suprstar:

- Card back > Redirect URI equals the suggested `<origin>/api/connections/oauth/callback` and that same string is in Google Cloud > Credentials > OAuth client > Authorized redirect URIs. Note the API server origin (`config.clientUrl` vs API host) if the SPA and API are on different hosts.
- Card back > Client ID ends with `.apps.googleusercontent.com`; secret pasted without whitespace.
- Card back > Scopes: the three defaults ticked; nothing else.
- Card back > Mode = Live.
- The `?error=` value in the URL after redirect: it is Google's `error_description` or the app message quoted above.

Fix: correct the mismatched value, save the card, click Connect again. For Testing apps add the account under OAuth consent screen > Test users. For accounts without a channel, create one at youtube.com first, then reconnect and pick the right account at the account chooser.

Source: https://developers.google.com/identity/protocols/oauth2/web-server

## Connection test fails

The test calls `GET /youtube/v3/channels?part=snippet,statistics&mine=true` and reports three checks: Credentials present, Access token present, YouTube API reachable.

| Test detail | Likely cause | Fix |
|---|---|---|
| "Credentials present" false | Client ID or secret empty | Fill card back, Save. |
| "Access token present" false | Never connected, or Disconnect was pressed | Click Connect. |
| Reachable false, message "The request uses the `mine` parameter but is not properly authorized." or `401` | Access token expired (suprstar does not auto-refresh) | Card back > Refresh token; if that returns `invalid_grant`, reconnect. |
| Reachable false, "The OAuth 2.0 token provided specifies scopes insufficient..." | `youtube.readonly` not granted (user unticked it on the granular consent screen) | Re-tick scope, reconnect; `prompt=consent` forces the consent screen again. |
| Reachable false, "The user has an unlinked Google Account without a YouTube channel." or app text "No YouTube channel found for this account." | Google account has no channel | Create channel, reconnect. |
| Reachable false, "...exceeded your quota." | Project daily quota used up | Wait for midnight PT or request more quota. |
| Reachable false, "YouTube Data API v3 has not been used in project ... or it is disabled" (**unverified** wording) | API not enabled in the project owning the Client ID | Enable YouTube Data API v3. |

Also check: Token status on the card back shows an expiry in the past -> Refresh token. If the refresh button is disabled there is no access token at all -> Connect.

Sources: https://developers.google.com/youtube/v3/docs/errors, https://developers.google.com/youtube/v3/docs/channels/list

## Publish fails immediately

The adapter reads the whole file, then sends one multipart `videos.insert`. Failure text in the job is Google's `error.message` or `YouTube upload failed (<status>)`.

| Message | Cause | Fix |
|---|---|---|
| "YouTube requires a video file to publish." | Post media is an image or empty | Attach a video. |
| `401` / "Invalid Credentials" (**unverified** text) | Token expired | Refresh token, retry the job. |
| "The OAuth 2.0 token provided specifies scopes insufficient..." | `youtube.upload` not granted | Tick scope, reconnect. |
| "The request metadata specifies an invalid or empty video title." | No title on post/target | Set a title (max 100 chars, no `<` `>`). |
| "The request metadata specifies an invalid video description." | Caption > 5000 bytes or contains `<`/`>` | Shorten/clean caption; multibyte text counts as more bytes. |
| "The snippet.categoryId property specifies an invalid category ID." | Card-back Category not a valid numeric ID | Use 22 or another valid ID from `videoCategories.list`. |
| "The request attempts to set an invalid privacy setting for the video." | Privacy value rejected | Use public/private/unlisted. |
| "The request does not include the video content." | Media file missing on disk or zero bytes | Re-upload media in the library. |
| "The request cannot be completed because you have exceeded your quota." | 100 uploads/day bucket or 10,000 units gone | Wait for PT midnight; request extension (needs compliance audit). |
| "The user has exceeded the number of videos they may upload." / "The channel's daily video upload limit has been reached." | Channel-level daily cap | Wait 24 h; verify channel by phone. |
| "The YouTube account of the authenticated user is suspended." | Account action | Resolve on YouTube. |
| `YouTube upload failed (413)` / socket errors / ECONNRESET / Node heap errors | File too large for a single in-memory multipart request or network drop | Use a smaller file; long-term fix is the resumable upload protocol with 256 KB-multiple chunks and exponential backoff on 5xx. |
| `YouTube upload failed (500|502|503|504)` | Transient Google error | Retry with backoff; no automatic retry exists. |

Sources: https://developers.google.com/youtube/v3/docs/videos/insert, https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

## Post stuck "processing"

suprstar marks the job succeeded as soon as `videos.insert` returns an `id`; it never reports YouTube's processing state. So a "stuck" post is either:

1. YouTube still transcoding (`status.uploadStatus: uploaded`, `processingDetails.processingStatus: processing`). Large or high-resolution files take longer. Nothing to do but wait.
2. Processing failed (`uploadStatus: failed`, `failureReason` in `codec`, `conversion`, `emptyFile`, `invalidFile`, `tooSmall`, `uploadAborted`).
3. The upload never completed because suprstar's job itself is still `running` (large file being buffered/sent).

What to check: the job status in suprstar (running vs succeeded); then `GET /youtube/v3/videos?part=status,processingDetails&id=<externalId>` with the connection's token, or YouTube Studio > Content. Fix for failed processing: re-encode to MP4 (H.264/AAC), re-publish.

Source: https://developers.google.com/youtube/v3/guides/implementation/videos

## Post published but not visible

| Cause | How to confirm | Fix |
|---|---|---|
| Unverified API project: "All videos uploaded via the `videos.insert` endpoint from unverified API projects created after 28 July 2020 will be restricted to private viewing mode." | In YouTube Studio the video shows Private although suprstar sent `public`; changing it manually in Studio works | Complete the YouTube API Services compliance audit (Audit and Quota Extension Form); until then publish privately and switch in Studio. |
| Card-back Privacy set to `private` or `friends` (`friends` becomes `unlisted`) | Check card back default post settings | Set Privacy to public. |
| Still processing | `processingDetails.processingStatus: processing` | Wait. |
| Rejected after processing (`rejectionReason`: `duplicate`, `copyright`, `length`, `inappropriate`, `termsOfUse`, ...) | `videos.list?part=status` | Fix content; `length` means the channel is not verified for >15 min uploads. |
| `notifySubscribers` true but no notification | Expected; notifications are best-effort | n/a. |
| Wrong channel | Card front handle vs the channel in Studio; brand accounts appear at the Google account chooser | Reconnect and pick the intended channel. |

Sources: https://developers.google.com/youtube/v3/revision_history, https://developers.google.com/youtube/v3/docs/videos

## Metrics empty

- Expected today: `fetchMetrics` in `server/src/platforms/youtube.ts` returns `[]` for Live connections; only Sandbox generates numbers. There is no bug to fix on the connection.
- When implemented it will need: YouTube Analytics API enabled in the Cloud project; `yt-analytics.readonly` granted (already requested); `GET https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=...&endDate=...&metrics=views,likes,comments,shares,subscribersGained&dimensions=day`. Empty `rows` for a valid query usually means no data for the range or the channel has no views; the most recent day or two are commonly incomplete (**unverified**).

Source: https://developers.google.com/youtube/analytics/reference/reports/query

## Token expired every day / keeps needing reconnect

| Symptom | Cause | Fix |
|---|---|---|
| Publish/test fails ~1 hour after connect with `401` | Access token lifetime is short and suprstar has no automatic refresh | Press Refresh token before publishing; product fix: refresh when `tokenExpiresAt` is near in the publisher. |
| Refresh token returns `invalid_grant` about a week after connecting | Consent screen publishing status is **Testing**: "issued a refresh token expiring in 7 days" | Move the consent screen to In production (requires verification for sensitive scopes) or accept weekly reconnects. |
| Refresh works for weeks then dies | User revoked access at myaccount.google.com, token unused 6 months, or >50 refresh tokens for this client/user (each reconnect with `prompt=consent` creates another) | Reconnect; avoid repeated reconnects. |
| Refresh token empty on the card back | Connected without `access_type=offline` (older adapter) or the response omitted it | Disconnect, Connect again (adapter sends `access_type=offline&prompt=consent`). |
| Google Workspace account | Admin policy revoked or `admin_policy_enforced` | Admin must allow the app. |

Sources: https://developers.google.com/identity/protocols/oauth2, https://developers.google.com/identity/protocols/oauth2/web-server

## Duplicate content rejected

- YouTube accepts the upload (`200`, new video id) and later sets `status.uploadStatus: rejected`, `status.rejectionReason: duplicate` when the file is identical to one already on the channel. suprstar cannot see this because it does not poll; the post looks published, the video shows "Duplicate" in Studio.
- Check: `videos.list?part=status&id=<id>` or Studio. Fix: delete the older copy or re-export the video so bytes differ; then re-publish. Avoid retrying a failed job blindly if the first attempt actually reached YouTube (the job may have failed after the upload completed).

Source: https://developers.google.com/youtube/v3/docs/videos

## Rate limited

| Signal | Meaning | Action |
|---|---|---|
| `403 quotaExceeded` "The request cannot be completed because you have exceeded your quota." | Daily bucket exhausted: 100 `videos.insert` calls, or 10,000 units for other calls (test/profile = 1 unit each) | Stop retrying; resume after midnight PT; check Cloud console > Quotas; request extension via the YouTube API Services quota form (compliance audit required). |
| `429 tooManyRequests` (`uploadRateLimitExceeded`) | Short-term burst | Exponential backoff (1 s, 2 s, 4 s ... with jitter). |
| `400 uploadLimitExceeded` | Channel-level daily cap | Wait 24 h; channel verification raises limits (**unverified** amounts). |
| Repeated `5xx` | Transient | Backoff and retry; adopt resumable uploads so a retry does not resend the whole file. |

Remember: multiple suprstar connections that share one Client ID share one quota; every invalid request still costs 1 unit.

Sources: https://developers.google.com/youtube/v3/determine_quota_cost, https://developers.google.com/youtube/v3/docs/errors

## Quick console checklist (Google Cloud)

1. APIs & Services > Enabled APIs: YouTube Data API v3 (and YouTube Analytics API for metrics).
2. OAuth consent screen: user type External; publishing status (Testing = 7-day refresh tokens + test-user list; In production = verification for sensitive scopes); scopes list includes `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly`.
3. Credentials: Web application client; Authorized redirect URIs contains the exact suprstar callback.
4. Quotas page: Video Uploads bucket and general units remaining.
5. YouTube API Services compliance audit status if uploads are forced private.
