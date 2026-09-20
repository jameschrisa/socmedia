---
platform: instagram
topic: troubleshooting
sources:
  - https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
  - https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
  - https://developers.facebook.com/docs/graph-api/guides/error-handling
  - https://developers.facebook.com/docs/graph-api/overview/rate-limiting
  - https://developers.facebook.com/docs/graph-api/overview/access-levels
  - https://developers.facebook.com/docs/development/build-and-test/app-modes
  - https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started
  - https://developers.facebook.com/docs/instagram-platform/content-publishing
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights
fetched: 2026-09-19
---

# Instagram troubleshooting checklist for suprstar

How to read this file: each section is a symptom. "What to check in suprstar" refers to the Social Profiles card back (Label, Client ID = Meta App ID, Client secret = App Secret, Redirect URI, Scopes checkboxes, Mode Sandbox/Live, Default post settings including **Instagram business account ID**, Token status + **Refresh token** button) and the card front (**Test connection**, **Connect**/**Disconnect**). "What to check in Meta" refers to the Meta App Dashboard (developers.facebook.com/apps).

## First checks for every Instagram problem

1. **Mode**: Sandbox never calls Meta. If the card is in Sandbox, every success is simulated and every failure is a local credentials/token gap. Switch to Live to test the real integration.
2. **Account type**: the Instagram account must be Business or Creator and linked to a Facebook Page; the Facebook user connecting must have a task role on that Page (get-started guide). Personal Instagram accounts cannot be used.
3. **Token age**: suprstar stores a short-lived token (about 1-2 h) at Connect and only upgrades it when **Refresh token** is pressed. Check Token status on the card back; if the expiry is less than a day away right after connecting, press Refresh.
4. **Graph version**: the adapter uses `v21.0`, available until January 21, 2027.
5. **Scope grants**: run `GET /debug_token?input_token=<token>&access_token=<AppID>|<AppSecret>` and compare `scopes` to the five card-back scopes.

## Connect button loops back / lands on /connections?error=...

Likely causes:

- Redirect URI on the card back is not in **Valid OAuth Redirect URIs**, or is HTTP.
- App ID / App Secret wrong (secret reset in the dashboard).
- App in Development mode and the Facebook user has no role.
- User cancelled or declined a permission.
- Facebook Login for Business configuration does not include the requested permissions ("permissions ... Facebook Login for Business doesn't support ... will be revoked immediately").
- `state` lost by a proxy that strips query strings.

What to check in suprstar:

- Read the `error` query parameter on `/connections`: `Missing code or state parameter` = Facebook did not return a code (cancel/decline/redirect stripped); `Unknown connection` = card deleted; an `OAuthException` message = token exchange or profile lookup failed; `No Facebook Page with a linked Instagram Business account was found.` = login worked but the account linkage is wrong.
- Card back Redirect URI equals the suggested `{origin}/api/connections/oauth/callback`, HTTPS, no trailing whitespace.
- Client ID / Client secret re-pasted from App settings > Basic.
- Scopes: all five ticked (an unticked `pages_show_list` or `instagram_basic` breaks the profile lookup in the callback).
- Mode is Live (in Sandbox, Connect never opens Facebook; if a Facebook dialog is expected and nothing happens, the card is in Sandbox).

What to check in Meta:

- Facebook Login (for Business) > Settings > Valid OAuth Redirect URIs contains the exact value.
- App Mode: Development requires the user under App Roles; Live requires App Review-approved permissions.
- Permissions and Features: each of the five scopes shows Standard or Advanced Access; for non-role users, Advanced Access and Business Verification are required.
- If the user previously declined a permission, ask them to remove the app at facebook.com > Settings > Apps and Websites, then reconnect (suprstar does not send `auth_type=rerequest`).

Fix: correct the mismatched item, save the card back, press Connect again, then press Refresh token once connected.

## Connection test fails

The test calls `/me/accounts?fields=instagram_business_account,name` then `/{ig-user-id}?fields=username,name,profile_picture_url,followers_count`. The result appears under the card with three checks: Credentials present, Access token present, Instagram Graph API reachable (with the error text).

| Test message | Likely cause | Fix |
|---|---|---|
| Access token present = false | Never connected or Disconnect pressed | Connect |
| `Error validating access token: Session has expired ...` (code 190/463) | Short-lived token expired (~1-2 h) or long-lived expired (~60 d) | Reconnect, then Refresh token |
| code 190 subcode 458 / 460 / 467 | User revoked app, changed password, or session invalidated | Reconnect |
| `No Facebook Page with a linked Instagram Business account was found.` | Page not linked to IG professional account, or user has no Page task role, or `pages_show_list` not granted | Link Page and IG account (Instagram > Settings > Business tools > Connect a Facebook Page; or Page > Settings > Linked accounts); give the user a Page role; tick `pages_show_list`; reconnect |
| `(#10) Application does not have permission for this action` / codes 200-299 | Scope not granted or not approved | `debug_token` to verify; App Review / role user |
| `Unsupported get request. Object with ID ...` (code 100/33) | Card-back Instagram business account ID is wrong or belongs to another account (used by publish; the test still goes through `/me/accounts`) | Clear the field so the Page lookup is used, or paste the correct IG user id from `/{page-id}?fields=instagram_business_account` |
| HTTP 500-level `Instagram page lookup failed (5xx)` | Meta outage (codes 1/2) | Retry later |
| Rate limit (codes 4/17/32/613) | Too many calls in the window | Wait `estimated_time_to_regain_access` minutes from `X-Business-Use-Case-Usage` |

Note: a test failure on a previously connected card flips its status to `error`; a later successful test sets it back to `connected`.

## Publish fails immediately

Check the publish job message (post detail / jobs view). Map by message:

| Message | Cause | Fix |
|---|---|---|
| `Instagram posts require at least one media file.` | Text-only post targeted Instagram | Attach an image (JPEG) or video |
| `The media could not be fetched from this uri:` (9004/2207052) or `It takes too long to download the media.` (2207003) | suprstar media URL not publicly reachable: localhost, private IP, auth wall, HTTP redirect chain, slow host | Serve suprstar over a public HTTPS URL; confirm `curl -I <media url>` from outside returns 200 with `image/jpeg` or `video/mp4` |
| `The image format ... is not supported.` (36001/2207005) | PNG, WebP, HEIC, GIF | Convert to JPEG (only supported format) |
| `The image is too large to download...` (36000/2207004) | Image over 8 MB | Re-export smaller |
| `The submitted image with aspect ratio...` (36003/2207009) | Image outside 4:5-1.91:1 (e.g. a 9:16 export) | Use square, 4:5 or 1.91:1 for images; 9:16 only for video (Reels) |
| `The submitted image's caption was...` (36004/2207010) | Caption over 2200 chars | Shorten caption/hashtags (30 hashtags, 20 @mentions max) |
| `The video format is not supported.` (352/2207026) | Wrong container/codec | MP4/MOV, H.264 or HEVC, AAC 48 kHz, moov atom first, no edit lists, 23-60 fps, max 1920 px wide, 25 Mbps, 3 s-15 min, 300 MB |
| `The Instagram account is restricted.` (25/2207050) | Account restricted by Instagram | User resolves in the Instagram app |
| `We restrict certain activity to protect our community.` (4/2207051) | Spam throttling | Slow down; vary captions |
| `You reached maximum number of posts that is allowed...` (9/2207042) | Publishing quota (50 or 100 per 24 h; read `content_publishing_limit`) | Wait for the 24 h window |
| `The calling app is missing the ads_management...` (200) | User's Page role comes via Business Manager | Assign a direct Page role or add `ads_management`/`ads_read` |
| `(#10) ...permission...` / 200-299 | `instagram_content_publish` unticked, not granted, or no Advanced Access for a non-role user | Tick the scope, reconnect, `debug_token`; App Review |
| code 190 | Token expired (no auto-refresh before publish) | Reconnect + Refresh token, then re-run the job |
| `Unsupported get request...` (100/33) | Wrong Instagram business account ID on the card back | Correct or clear the field |
| `No Facebook Page with a linked Instagram Business account was found.` | No IG user id saved and Page lookup failed | See connection test section |
| `Instagram media creation failed (<status>)` with no Meta message | Non-JSON response (proxy, outage) | Retry; check server logs for the raw body |

What to check in suprstar: media kind and format of the first attachment (only `media[0]` is sent; carousels are not supported), caption length, card-back scopes, token status, Instagram business account ID, Mode = Live, that the server's public base URL (used by `toAbsoluteUrl`) is reachable from the internet.

## Post stuck processing / "Timed out waiting for Instagram media container"

Cause: for videos suprstar polls `status_code` once per second for at most 20 polls (about 20 s). Meta's guidance is to poll "once per minute, for no more than 5 minutes"; Reels transcoding routinely takes longer than 20 s. The job is marked failed with `Timed out waiting for Instagram media container to finish processing.` while Meta may still finish the container (it stays valid 24 h) but nothing publishes it.

What to check:

- Video length and size: shorter, lower-bitrate files finish faster.
- Was the container `ERROR`? Then the message is `Instagram media container failed to process.`; query `GET /{container-id}?fields=status,status_code`: `status` holds the error subcode (e.g. `2207026` unsupported format, `2207052` fetch failed).
- Whether a duplicate got published: each retry creates a new container; an earlier container that later reached `FINISHED` is never published by suprstar, so retries do not double-post. Verify in the Instagram app before retrying.

Fix: retry the publish (new container). If it times out repeatedly, re-encode to H.264/AAC MP4 with moov atom first and a lower bitrate; or publish manually with `POST /media_publish?creation_id=<old container>` if the old container shows `FINISHED` and is younger than 24 h. Long-term fix: raise the adapter's poll window toward Meta's 5-minute guidance.

## Post published but not visible

Likely causes:

- **Link 404s**: suprstar builds `externalUrl` as `https://www.instagram.com/p/{ig-media-id}/`, but Instagram permalinks use the `shortcode`, not the numeric media id. The post exists; the link is wrong. Get the real URL with `GET /{ig-media-id}?fields=permalink,shortcode`.
- Reel not in the Feed tab: `share_to_feed` was not sent; default behaviour applies (suprstar's "Share reels to feed" setting has no effect). Look in the Reels tab.
- App in Development mode: "Data created here (test posts, etc.) remains visible only to role users until the app transitions to Live mode."
- Media published to a different IG account: the card-back Instagram business account ID points at another account, or `/me/accounts` picked the first Page with an IG account and the user manages several.
- `media_publish` succeeded but the account is under review/restriction.

What to check in suprstar: the job's `externalId` (numeric media id), the card's handle (which account was connected), the Instagram business account ID field. Fix: read `permalink`; set the correct IG user id on the card back; go Live if testers only should not be the audience.

## Metrics empty

Cause in suprstar: `fetchMetrics` for Live Instagram requests `/insights?metric=impressions,reach,follower_count&period=day` and then returns `[]` regardless of the response. Live Instagram metrics are therefore always empty; only Sandbox shows numbers. There is nothing to configure.

If/when the adapter is completed, the following will also produce empty or error results:

- `impressions` is deprecated (v22.0+, sunset April 21, 2025): use `views` with `metric_type=total_value`.
- `follower_count` unavailable under 100 followers.
- `instagram_manage_insights` not granted / no Advanced Access for non-role users.
- Data delay "up to 48 hours".
- Stories with fewer than 5 views return code `10` "Not enough viewers for the media to show insights"; story metrics last 24 h.

## Token expired every day (or every hour)

Cause: suprstar never exchanges for a long-lived token on its own. The token stored at Connect is short-lived ("typically last about one to two hours"). If nobody presses **Refresh token**, the card shows expired within hours and every Live call fails with code `190`.

What to check in suprstar: Token status expiry on the card back. If it reads about 1-2 h after connect time, the token is short-lived.

Fix: press **Refresh token** while the short-lived token is still valid; the expiry should jump to about 60 days. If it has already expired, "You can not use an expired token to request a long-lived token": Connect again, then Refresh immediately. For the 60-day token, press Refresh again before it expires (Meta does not document a minimum age for `fb_exchange_token` re-exchange; the 24 h rule applies to `ig_refresh_token` only). Also check that nobody else is revoking the app (subcode `458`) or that the user's password is not being changed (subcode `460`).

## Duplicate content rejected

Meta error: code `506` "Duplicate Post" (guidance "Change the content of the post and try again"), or code `4` / subcode `2207051` "We restrict certain activity to protect our community." for repetitive publishing.

What to check in suprstar: whether the same post was retried after a timeout (see "stuck processing"), whether multiple Instagram cards point at the same IG user id (two connections publishing the same post), and whether a scheduled post ran twice.

Fix: change the caption or media, wait, and retry; consolidate duplicate cards; delete the duplicate on Instagram if one got through.

## Rate limited

Errors: code `4` (app), `17` (user), `32` (Pages), `613`, `80001` (BUC), or the publishing quota `9`/`2207042`.

What to check:

- Response headers on the failing call: `X-App-Usage.call_count` near 100, or `X-Business-Use-Case-Usage[...].estimated_time_to_regain_access` (minutes).
- `GET /{ig-user-id}/content_publishing_limit?fields=quota_usage,config` for publishing quota (`quota_total` currently reported as 50; guide says 100).
- Container creation cap: 400 per rolling 24 h; every failed publish attempt consumes one.
- Scheduler bursts: many posts scheduled at the same minute across several Instagram cards on the same app.

Fix: stop calling until `estimated_time_to_regain_access` has passed ("Continuing to make calls will continue to increase your call count"); spread scheduled posts; re-run failed jobs manually after the window. suprstar has no automatic retry or backoff.

## Quick reference: card-back field to Meta setting

| Card back field | Meta equivalent | Where |
|---|---|---|
| Client ID | App ID | App settings > Basic |
| Client secret | App Secret | App settings > Basic (Show) |
| Redirect URI | Valid OAuth Redirect URIs | Facebook Login (for Business) > Settings |
| Scopes | Permissions and Features (access level) and Login for Business configuration | App Review > Permissions and Features; Facebook Login for Business > Configurations |
| Mode Live | App Mode Development/Live + App Roles | App Dashboard header toggle; App Roles |
| Instagram business account ID | `instagram_business_account.id` | `GET /{page-id}?fields=instagram_business_account` or Page settings > Linked accounts |
| Token status / Refresh token | `debug_token` `expires_at`; `grant_type=fb_exchange_token` | Graph API Explorer / Access Token Debugger |
