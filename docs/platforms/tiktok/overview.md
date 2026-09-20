---
platform: tiktok
topic: overview
sources:
  - https://developers.tiktok.com/doc/content-posting-api-get-started
  - https://developers.tiktok.com/doc/content-sharing-guidelines
  - https://developers.tiktok.com/doc/tiktok-api-scopes
  - https://developers.tiktok.com/doc/scopes-overview
  - https://developers.tiktok.com/doc/app-review-guidelines
  - https://developers.tiktok.com/doc/getting-started-faq
  - https://developers.tiktok.com/blog/introducing-sandbox
  - https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit
  - https://developers.tiktok.com/doc/tiktok-api-v2-video-object
  - https://developers.tiktok.com/products/content-posting-api/
fetched: 2026-09-19
---

# TikTok: platform overview for suprstar

This file describes what the TikTok for Developers (TT4D) APIs used by suprstar can do, how app review / audit and sandbox mode gate that behaviour, and the quotas that apply. It is written against the suprstar adapter in `server/src/platforms/tiktok.ts` and the spec in `shared/src/platforms.ts`.

## What suprstar uses on TikTok

Source: suprstar code (`server/src/platforms/tiktok.ts`, `shared/src/platforms.ts`).

| Capability | TikTok product / endpoint | Used by suprstar |
|---|---|---|
| Sign-in and user consent | Login Kit (web) `https://www.tiktok.com/v2/auth/authorize/` | Yes: "Connect" button |
| Token exchange / refresh | `POST https://open.tiktokapis.com/v2/oauth/token/` | Yes: OAuth callback and card-back "Refresh token" |
| Profile lookup (connection test) | Display API `GET https://open.tiktokapis.com/v2/user/info/` | Yes: connection test, avatar/handle/follower count |
| Direct-post a video | Content Posting API `POST /v2/post/publish/video/init/` | Yes: `source: "PULL_FROM_URL"`, `privacy_level: "SELF_ONLY"` |
| Direct-post photos (carousel) | Content Posting API `POST /v2/post/publish/content/init/` | Yes: `post_mode: "DIRECT_POST"`, `media_type: "PHOTO"` |
| Post status polling | `POST /v2/post/publish/status/fetch/` | No (not called; a publish is treated as done once a `publish_id` is returned) |
| Creator info pre-check | `POST /v2/post/publish/creator_info/query/` | No |
| Upload to drafts (inbox) | `POST /v2/post/publish/inbox/video/init/` | No |
| Video list / per-video stats | Display API `/v2/video/list/`, `/v2/video/query/` | No (`fetchMetrics` returns `[]`) |
| Research API | `research.data.*` scopes | No (not applicable to a publishing app) |

Scopes requested by default (from `PLATFORM_SPECS.tiktok.oauth.scopes`): `user.info.basic`, `user.info.stats`, `video.publish`, `video.upload`, `video.list`.

## Products and scopes

Source: https://developers.tiktok.com/doc/tiktok-api-scopes and https://developers.tiktok.com/doc/scopes-overview

Scopes are attached to products in the TT4D app configuration. The app must be approved for a scope before it can request it from users: "After you are approved for certain scopes on TikTok for Developers, users will be asked to authorize and confirm your access." Scopes are added under the app's **Scopes** section ("Click the Add Scopes button, then add your desired scopes"). Being approved for a scope "alone does not give you access to a user's data": each user must still consent, and "Users can grant or deny the requested scopes or any subset of them, and revoke the authorization at any time on their TikTok apps."

| Scope | Product | What it unlocks (official description) | Needed by suprstar for |
|---|---|---|---|
| `user.info.basic` | Login Kit / User Info API | "Read a user's profile info (open id, avatar, display name ...)" | Connection test, `open_id`, `avatar_url`, `display_name` |
| `user.info.profile` | User Info API | `profile_web_link`, `profile_deep_link`, `bio_description`, `is_verified`, `username` | Not requested (so `username` is not available; suprstar derives the handle from `display_name`) |
| `user.info.stats` | User Info API | "a user's statistical data, such as likes count, follower count, following count, and video count" | `follower_count` on the profile card |
| `video.list` | Display API (List Videos, Query Videos) | "Read a user's public videos on TikTok" | Requested; reserved for future metrics |
| `video.upload` | Content Posting API (Upload) | "Share content to creator's account as a draft to further edit and post in TikTok"; also Get Post Status | Requested; photo posts accept `video.publish` or `video.upload` |
| `video.publish` | Content Posting API (Direct Post) | "Directly post content to a user's TikTok profile"; also Get Post Status | Video and photo direct posts |

Products that must be added to the TT4D app for suprstar to work: **Login Kit** (with a web redirect URI) and **Content Posting API** with the **Direct Post** configuration enabled ("Content Posting API product added to app" and "Direct Post configuration enabled" are listed as prerequisites).

## Sandbox vs production (TikTok side)

Source: https://developers.tiktok.com/blog/introducing-sandbox and https://developers.tiktok.com/doc/app-review-guidelines

TikTok's own Sandbox is "a restricted environment that allows you to try out integrations without having to submit your app for review." Facts verified on the official site:

- Created from the app page: "switch the toggle next to your app's name to Sandbox. Click the Create Sandbox button, then enter a name." You may "create up to 5 sandboxes."
- Target users: "You can share your Sandbox with up to 10 other TikTok accounts by adding target users." Only these accounts can authorize a sandbox client.
- A sandbox has its own configuration and its own credentials; when ready "you can import your Sandbox configuration to a Draft of your app in Production mode to get it ready for submission."
- First-time approvals must use it: "If your app has not been approved before, you are required to use a sandbox environment" for the demo video.

Unverified on the official site: which products/scopes are unavailable inside a Sandbox and whether sandbox posts are visible outside target-user accounts. Treat a TikTok Sandbox as: same endpoints, same request shapes, but only target users can log in.

Do not confuse this with suprstar's own **Mode: Sandbox / Live** switch on the Social Profiles card back. suprstar's Sandbox mode never calls TikTok at all (tokens, profile, publish and metrics are simulated in `server/src/platforms/sandbox.ts`). suprstar's Live mode calls the real endpoints with whatever `client_key` / `client_secret` is on the card; those credentials can belong to either a TikTok Sandbox or a TikTok production app.

## App review / audit and the "unaudited client" restrictions

Source: https://developers.tiktok.com/doc/content-sharing-guidelines, https://developers.tiktok.com/doc/content-posting-api-get-started, https://developers.tiktok.com/doc/app-review-guidelines, https://developers.tiktok.com/doc/getting-started-faq

Until the Content Posting API integration passes audit, these restrictions apply and are the single most common cause of "it published but nobody can see it" reports:

- "All content posted by unaudited clients will be restricted to private viewing mode."
- "Unaudited API Clients can only post contents in `SELF_ONLY` viewership."
- "Unaudited API Clients can allow up to 5 users to post in a 24 hour window. All user accounts using the API client to post must be set to private at the time of posting."
- To make such content public later, the account owner must "first change their account visibility to public, and then change the privacy settings of each content to 'Everyone.'"
- Lifting the restriction: "your API client must undergo an audit to verify compliance with our Terms of Service."

suprstar hardcodes `privacy_level: "SELF_ONLY"` on video posts, which is the only value an unaudited client can use. After the client is audited, that line has to change (see `publishing.md`) before posts can be public.

App review facts:

- "App review may take several days to two weeks after submission."
- Required: "at least one demo video that shows the complete end-to-end flow of the up-to-date integrations. You may upload a maximum of 5 videos, up to 50 MB each." "All selected products and scopes must be clearly demonstrated in the video."
- "Beta or development versions, incomplete apps, and test versions are not encouraged and will not be approved"; apps must not be "for private or personal use."
- "If you have a web application and are applying for Login Kit access, you must provide a valid redirect URI."

## URL ownership verification (required for `PULL_FROM_URL`)

Source: https://developers.tiktok.com/doc/content-sharing-guidelines and https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide

suprstar hands TikTok a URL on its own server (`toAbsoluteUrl(asset.url)`) for both videos and photos. The rule: "The supplied URL must be under the path of a domain or URL prefix API Clients have ownership on. The ownership needs to be verified through the Manage URL properties flow on the Manage Apps page in your TT4D app." Additionally the media URL "must use 'https'", "should not redirect to another URL", and "must remain accessible for the entire duration of the download process, which times out one hour." A `localhost` or unverified host returns `url_ownership_unverified`.

## Quotas and rate limits

Source: https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit, https://developers.tiktok.com/doc/content-posting-api-reference-direct-post, https://developers.tiktok.com/doc/content-posting-api-reference-photo-post, https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info, https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status, https://developers.tiktok.com/doc/content-sharing-guidelines

| Limit | Value (verified 2026-09-19) |
|---|---|
| `/v2/user/info/`, `/v2/video/query/`, `/v2/video/list/` | "600 requests per minute" default, "one minute sliding window" |
| `/v2/post/publish/video/init/` | "Each user access_token is limited to 6 requests per minute." |
| `/v2/post/publish/content/init/` (photos) | "Each user access_token is limited to six requests per minute." |
| `/v2/post/publish/inbox/video/init/` | "Each user access_token is limited to 6 requests per minute." |
| `/v2/post/publish/creator_info/query/` | "Each user access_token is limited to 20 requests per minute." |
| `/v2/post/publish/status/fetch/` | "Each user access_token is limited to 30 requests per minute" |
| Posts per creator per 24 h (audited and unaudited) | "upper limit" is "around 15 posts per day/ creator account" |
| Publishing users per 24 h, unaudited client | 5 users (`reached_active_user_cap` when exceeded) |
| Pending inbox shares | "at most 5 pending shares within any 24-hour period" |
| Access token lifetime | "valid for 24 hours after initial issuance" |
| Refresh token lifetime | "valid for 365 days after the initial issuance" |
| `upload_url` validity (FILE_UPLOAD) | "valid for one hour after issuance" |
| `PULL_FROM_URL` download window | "times out one hour" |

On breach: "a response will be returned with HTTP status `429` and error code `rate_limit_exceeded`." No retry headers are documented; higher limits are requested via the TT4D support page.

## Metrics availability

Source: https://developers.tiktok.com/doc/tiktok-api-v2-video-object, https://developers.tiktok.com/doc/tiktok-api-v2-video-query

There is no account-level analytics endpoint in the products suprstar is allowed to use. Per-video counters exist on the Display API Video Object (`like_count`, `comment_count`, `share_count`, `view_count`, plus `id`, `create_time`, `share_url`, `duration`, `title`, `video_description`, `embed_link`, `is_aigc`) via `POST /v2/video/list/` (max 20 per page) or `POST /v2/video/query/` (`filters.video_ids`, up to 20 ids), scope `video.list`. suprstar's `fetchMetrics` for TikTok currently returns an empty array, so the Overview page shows no TikTok metrics for live connections; only Sandbox-mode connections show (simulated) metrics. The Research API (`research.data.basic` etc.) requires a separate application and is not relevant.

## Date-sensitive items to re-check on refresh

- Rate-limit numbers above (6 / 20 / 30 / 600 per minute) and the ~15 posts/day cap.
- Unaudited-client user cap (5 per 24 h) and `SELF_ONLY` rule.
- Title limits: video `title` 2200 UTF-16 runes; photo `title` 90 and `description` 4000 UTF-16 runes.
- Legacy OAuth v1 endpoint `https://open-api.tiktok.com/oauth/access_token/` is deprecated; suprstar already uses v2.
