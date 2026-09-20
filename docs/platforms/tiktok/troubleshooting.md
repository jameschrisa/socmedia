---
platform: tiktok
topic: troubleshooting
sources:
  - https://developers.tiktok.com/doc/login-kit-web
  - https://developers.tiktok.com/doc/oauth-user-access-token-management
  - https://developers.tiktok.com/doc/oauth-error-handling
  - https://developers.tiktok.com/doc/content-sharing-guidelines
  - https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
  - https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
  - https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
  - https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
  - https://developers.tiktok.com/doc/tiktok-api-v2-error-handling
  - https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit
fetched: 2026-09-19
---

# TikTok: troubleshooting checklist for suprstar

How to read this file: each section is a symptom. Under it, likely causes in order of frequency, what to check on the **Social Profiles** card back (flip the TikTok card: Label, Client ID, Client secret, Redirect URI, Scopes, Mode, Default post settings, Token status + Refresh token, Test connection) and in the server logs, and the fix. Exact TikTok error strings are in `errors.md`.

## Where suprstar stores what

Source: suprstar code

| Card-back field | Maps to TikTok | Notes |
|---|---|---|
| Client ID | `client_key` | From the TT4D app (production) or a TikTok Sandbox (its own key) |
| Client secret | `client_secret` | Masked in the UI after save |
| Redirect URI | Login Kit web redirect URI | Suggested: `<origin>/api/connections/oauth/callback`; must be HTTPS and registered exactly |
| Scopes | `scope` param | Default: `user.info.basic,user.info.stats,video.publish,video.upload,video.list` |
| Mode | none | `Sandbox` = no TikTok calls at all; `Live` = real calls |
| Privacy / Allow duet / Allow stitch / Allow comments | none today | Adapter hardcodes `SELF_ONLY`, duet/stitch/comments enabled |
| Token status | `access_token` (24 h), `refresh_token` (365 d), `tokenExpiresAt` | Refresh is manual |

## "Connect button loops back" (returns to /connections with no account, or with `?error=`)

Source: https://developers.tiktok.com/doc/login-kit-web, https://developers.tiktok.com/doc/oauth-error-handling

Likely causes:

1. Redirect URI mismatch: `invalid_request` "Redirect_uri is not matched with the uri when requesting code." The card-back value differs from the registered one (trailing slash, `http://`, different host or port).
2. Redirect URI not HTTPS or not registered at all (Login Kit rejects before the consent screen; the browser may show a TikTok error page rather than returning).
3. Wrong credentials: `invalid_client`. Sandbox key with production secret, whitespace, or a key from another platform.
4. Scope not approved on the app: `invalid_scope` / `unauthorized_client`.
5. User is not a target user of a TikTok Sandbox client: `access_denied`.
6. Callback hit without parameters: suprstar string `Missing code or state parameter`.
7. Connection deleted mid-flow: `Unknown connection`.

Check in suprstar:

- Read the `error=` query string on the `/connections` page; it is the TikTok `error_description`.
- Card back -> Redirect URI equals, character for character, a URI listed under the TT4D app's Login Kit settings, and starts with `https://`.
- Card back -> Client ID / Client secret re-pasted from the same TT4D app (or the same Sandbox).
- Card back -> Scopes: every ticked scope is present under the app's **Scopes** section and approved.
- Mode is `Live` (in `Sandbox` mode the connect never leaves the app and cannot loop).
- Server log for the `connections` route: token exchange status code and `log_id`.

Fix: correct the field, **Save**, then **Connect** again. For local development with no HTTPS origin, use Mode `Sandbox` or an HTTPS tunnel with a stable hostname registered in Login Kit.

## "Connection test fails"

Source: https://developers.tiktok.com/doc/tiktok-api-v2-error-handling, https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info

The test calls `GET /v2/user/info/?fields=open_id,union_id,avatar_url,display_name,follower_count`. Detail rows: "Credentials present", "Access token present", "TikTok API reachable".

| Detail row / message | Cause | Fix |
|---|---|---|
| "Credentials present" false | Client ID or secret blank | Fill both, save |
| "Access token present" false | Never connected, or **Disconnect** was pressed | Connect |
| Message `The access token is invalid or not found in the request.` (401 `access_token_invalid`) | Access token older than 24 h, or user revoked the app in TikTok > Settings > Security > Manage app permissions | **Refresh token**; if refresh returns `invalid_grant`, reconnect |
| Message `Access token is invalid, some fields need additional scopes.` (400 `scope_permission_missed`) | `user.info.stats` not granted but `follower_count` is requested | Tick `user.info.stats`, reconnect |
| Message `The user did not authorize the scope required for completing this request.` (401 `scope_not_authorized`) | `user.info.basic` declined | Reconnect, accept all scopes |
| `The API rate limit was exceeded.` (429) | Test spam or shared client at 600 req/min | Wait 60 s |
| Network error / `TikTok profile fetch failed (5xx)` | TikTok outage or egress blocked | Check server outbound HTTPS to `open.tiktokapis.com`; retry |
| Test passes in Sandbox mode but not Live | Sandbox never calls TikTok | Expected; diagnose the Live credentials with the rows above |

## "Publish fails immediately"

Source: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post, https://developers.tiktok.com/doc/content-posting-api-reference-photo-post, https://developers.tiktok.com/doc/content-sharing-guidelines

The job fails on the init call; the message on the post is TikTok's `error.message`.

| Message / code | Cause | Fix |
|---|---|---|
| `TikTok posts require at least one media file.` | Text-only post targeted at TikTok | Attach a video or images |
| 401 `access_token_invalid` | Token expired (24 h); suprstar does not refresh before publishing | Card back -> **Refresh token** -> republish; for scheduled posts refresh shortly before the slot |
| 401 `scope_not_authorized` ("...does not bear user's grant on `video.publish` scope.") | `video.publish` not granted or Direct Post not enabled on the app | Card back -> Scopes tick `video.publish` -> reconnect; TT4D -> Content Posting API -> enable Direct Post |
| 403 `url_ownership_unverified` | Media URL host not verified, or `localhost`/`http` | Publish the suprstar server on an HTTPS domain; verify that domain under TT4D **Manage URL properties**; confirm `toAbsoluteUrl` builds URLs on that domain (check the app's public origin setting) |
| 403 `unaudited_client_can_only_post_to_private_accounts` | Creator account is public while the client is unaudited | Set the TikTok account to Private, or complete app audit |
| 403 `privacy_level_option_mismatch` | Privacy value not offered to this creator | Keep `SELF_ONLY` (current adapter) or implement `creator_info/query` |
| 403 `reached_active_user_cap` | 5 distinct users already posted today through the unaudited client | Wait 24 h or pass audit |
| 403 `spam_risk_too_many_posts` | ~15 posts/day/creator | Reschedule |
| 403 `spam_risk_user_banned_from_posting` | TikTok restriction on the account | Creator resolves with TikTok |
| 400 `invalid_param` on a photo post | Missing `privacy_level` (adapter gap) or `title` > 90 runes | Shorten caption to <= 90 chars; engineering: add `privacy_level` to `content/init` |
| 400 `invalid_param` on a video | Caption > 2200 runes, unsupported container/codec, or bad URL | Re-export MP4/H.264, 23-60 fps, 360-4096 px; shorten caption |
| 429 `rate_limit_exceeded` | > 6 init calls/min per token | Space posts >= 10 s apart per account |
| Publish works in Sandbox mode, fails in Live | Sandbox is simulated | Expected; diagnose with the rows above |

## "Post stuck processing"

Source: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status, https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide

suprstar marks a TikTok job `succeeded` as soon as init returns a `publish_id`; it never polls `/v2/post/publish/status/fetch/`. So "stuck processing" is observed on TikTok's side (video never appears in the creator's profile), not in the suprstar UI.

Likely causes:

1. TikTok could not download the `PULL_FROM_URL` media within the one-hour window (server went to sleep, URL required auth/session, redirect in front of the file, media deleted/re-encoded after scheduling).
2. Media outside spec (codec, fps < 23 or > 60, dimension < 360 or > 4096 px, > 10 min, > 4 GB).
3. The post is `SELF_ONLY` and the creator is looking at the public profile from another account (see next section).

Check: with the connection's access token, `POST /v2/post/publish/status/fetch/` `{"publish_id": "<externalId from the post>"}` (30 req/min). `PROCESSING_DOWNLOAD` = still fetching; `FAILED` + `fail_reason` = terminal. Also `curl -I` the media URL from outside the network: must be 200 over HTTPS with no redirect.

Fix: make the media URL stable and public for at least an hour after publish; re-export to MP4/H.264; republish. Engineering follow-up: poll status after init and surface `fail_reason`.

## "Post published but not visible"

Source: https://developers.tiktok.com/doc/content-sharing-guidelines, https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status

Likely causes:

1. Unaudited client: every post is private. Official text: "All content posted by unaudited clients will be restricted to private viewing mode." The creator sees it only when logged in; `publicaly_available_post_id` is empty.
2. suprstar sends `privacy_level: "SELF_ONLY"` on every video even after audit.
3. The link suprstar shows (`https://www.tiktok.com/@<display_name>`) points at the display name, not the @username, so the profile URL itself can be wrong.
4. TikTok is still downloading/processing (see previous section).

Check: card-back Scopes and TT4D app audit status; ask the creator to open their own profile while logged in and look for the lock icon.

Fix: to make an existing post public, the account owner must "first change their account visibility to public, and then change the privacy settings of each content to 'Everyone.'" To post publicly going forward: pass audit, then have engineering map card-back **Privacy** to `privacy_level` and validate against `privacy_level_options`.

## "Metrics empty"

Source: https://developers.tiktok.com/doc/tiktok-api-v2-video-object

Expected for live TikTok connections: `fetchMetrics` returns `[]` (no analytics endpoint is wired). Only Mode `Sandbox` connections show (simulated) TikTok metrics. If metrics were previously visible and vanished, the connection was probably switched from Sandbox to Live. Future implementation: `POST /v2/video/list/` / `/v2/video/query/` (`video.list`, already requested) provide `view_count`, `like_count`, `comment_count`, `share_count` per video; there is no follower-history endpoint (only the current `follower_count` from `/v2/user/info/` with `user.info.stats`).

## "Token expired every day"

Source: https://developers.tiktok.com/doc/oauth-user-access-token-management

This is by design: "It is valid for 24 hours after initial issuance." The refresh token lasts 365 days and rotates.

Check: card back -> Token status shows an expiry ~24 h after the last connect/refresh. Fix today: press **Refresh token** before publishing (or daily). If refresh fails with `invalid_grant`, the refresh token is expired/revoked: reconnect. Engineering fix: refresh automatically when `tokenExpiresAt` is within a few minutes of now, before every live call, and persist the rotated `refresh_token`.

## "Duplicate content rejected"

Source: https://developers.tiktok.com/doc/content-sharing-guidelines (caps), https://developers.tiktok.com/doc/content-posting-api-reference-direct-post

TikTok's public API docs do not define a "duplicate content" error code; the closest documented refusals are `spam_risk_too_many_posts` (daily cap) and `spam_risk_user_banned_from_posting`. Duplicate detection behaviour is unverified on the official site. Practical guidance:

- If the same video was retried after a timeout, two `publish_id`s may exist; the second may be processed as a duplicate by TikTok's spam systems (unverified) or count toward the daily cap.
- Check the job history for two `succeeded` jobs with different `externalId`s for the same post.
- Fix: do not retry init after an ambiguous timeout; change the video or caption when re-posting; wait for the 24 h window.

## "Rate limited"

Source: https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit, per-endpoint pages

HTTP 429 `rate_limit_exceeded` on a one-minute sliding window. Per user token: 6 init calls/min (video and photo), 20 creator-info/min, 30 status/min; per client: 600/min for `/v2/user/info/`, `/v2/video/list/`, `/v2/video/query/`.

Check: how many TikTok jobs the scheduler fired in the same minute for the same account; whether the connection test is being hammered by an automation. No rate-limit headers are documented, so rely on the 429 body.

Fix: stagger scheduled TikTok posts per account (>= 10 s apart), wait 60 s before retrying, and ask TT4D support for a higher limit if the client legitimately needs it.

## Quick decision tree

1. Error appears at connect -> `oauth.md` table; 9 times out of 10 it is the Redirect URI or wrong key/secret.
2. Test fails with 401 -> Refresh token; if `invalid_grant` -> reconnect.
3. Publish 403 -> audit / privacy / URL verification (`errors.md` publish table).
4. Publish "succeeded" but nothing on TikTok -> unaudited private post, or download failed (poll status manually).
5. Metrics empty on Live -> expected, not a fault.
