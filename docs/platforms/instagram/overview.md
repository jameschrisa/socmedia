---
platform: instagram
topic: overview
sources:
  - https://developers.facebook.com/docs/instagram-platform/overview
  - https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login
  - https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started
  - https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
  - https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
  - https://developers.facebook.com/docs/graph-api/overview/access-levels
  - https://developers.facebook.com/docs/development/build-and-test/app-modes
  - https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
  - https://developers.facebook.com/docs/graph-api/changelog
  - https://developers.facebook.com/docs/graph-api/overview/rate-limiting
  - https://developers.facebook.com/docs/instagram-platform/content-publishing
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
fetched: 2026-09-19
---

# Instagram Platform: overview for suprstar

This file describes what the Instagram API can do, the two login paths Meta offers, which one suprstar uses, app setup and review requirements, and the quotas that apply. It is written for an agent diagnosing connection, account and publishing problems; see `oauth.md`, `publishing.md`, `errors.md` and `troubleshooting.md` for the details.

## What suprstar uses

Source: `server/src/platforms/instagram.ts`, `shared/src/platforms.ts` (app code).

- Login path: **Instagram API with Facebook Login** (Facebook OAuth dialog, `graph.facebook.com`). The account must be an Instagram professional (Business or Creator) account linked to a Facebook Page.
- Graph API version hardcoded: **`v21.0`** (`https://www.facebook.com/v21.0/dialog/oauth`, `https://graph.facebook.com/v21.0/...`). Date-sensitive: see "Graph API versions" below.
- Scopes requested (comma-joined): `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`.
- Calls made: `GET /me/accounts?fields=instagram_business_account,name`, `GET /{ig-user-id}?fields=username,name,profile_picture_url,followers_count`, `POST /{ig-user-id}/media`, `GET /{container-id}?fields=status_code`, `POST /{ig-user-id}/media_publish`, `GET /{ig-user-id}/insights?metric=impressions,reach,follower_count&period=day`.
- Limits encoded in `shared/src/platforms.ts`: caption 2200 chars, 30 hashtags, max 10 media (but the adapter publishes only `media[0]`), max video 900 s, formats square / 4:5 / 9:16 / 1.91:1.
- Not used: Instagram API with Instagram Login (`graph.instagram.com`), Facebook Login for Business `config_id` configurations, carousels, stories, resumable uploads, `share_to_feed`, `permalink` lookup, Page access tokens.

## What the API can do

Source: https://developers.facebook.com/docs/instagram-platform/overview and https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login

The Instagram Platform lets an app act for "Instagram professional accounts" (Business and Creator accounts). Capabilities relevant to suprstar:

- Content publishing: single images, videos (as Reels), Stories, and carousels via container create + publish.
- Media management: read the account's media (`/{ig-user-id}/media`) and media fields such as `permalink`, `media_url`, `like_count`, `comments_count`.
- Insights: account-level (`/{ig-user-id}/insights`) and media-level (`/{ig-media-id}/insights`).
- Comment moderation, mentions, hashtag search (hashtag search and product tagging are "available only with Facebook Login").

Stated limitations:

- The API "cannot access Instagram consumer accounts (i.e., non-Business or non-Creator Instagram accounts)."
- Stories publishing "is restricted to business accounts only" (per the Facebook Login overview page).
- No result ordering; cursor-based pagination only (User Insights supports time-based pagination).
- Collaborators cannot access co-authored media data via the API, with limited exceptions.

## Two login paths

Source: https://developers.facebook.com/docs/instagram-platform/overview and https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login

| | Instagram API with Facebook Login (suprstar) | Instagram API with Instagram Login |
|---|---|---|
| User logs in with | Facebook credentials | Instagram credentials |
| Account requirement | Instagram professional account "linked to a Facebook Page"; the Facebook user must be able to perform Tasks on that Page | Instagram professional account; no Facebook Page needed |
| Base URL | `graph.facebook.com` | `graph.instagram.com` |
| Authorize URL | `https://www.facebook.com/{version}/dialog/oauth` | `https://www.instagram.com/oauth/authorize` |
| Token endpoint | `GET https://graph.facebook.com/{version}/oauth/access_token` | `POST https://api.instagram.com/oauth/access_token` |
| Long-lived token | `grant_type=fb_exchange_token` (about 60 days) | `grant_type=ig_exchange_token` (60 days), refresh with `grant_type=ig_refresh_token` |
| Permissions | `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement` (+ Instagram Public Content Access feature) | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages` (old scope values "deprecated on January 27, 2025") |
| App products | Facebook Login for Business, Messenger (with Instagram settings), "Instagram API setup with Facebook login" | "Instagram API setup with Instagram login" |
| Not available | | "cannot access ads or tagging"; no hashtag search |

Practical consequence for support: if a user's Instagram account is not linked to a Facebook Page, or the Facebook user has no Page role, suprstar's `/me/accounts` lookup returns no `instagram_business_account` and the connection test fails with the app message `No Facebook Page with a linked Instagram Business account was found.` Switching that user to the Instagram Login path would require a new adapter (not implemented).

## Meta app setup

Source: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started and https://developers.facebook.com/docs/facebook-login/facebook-login-for-business

Prerequisites listed by Meta:

- An Instagram Business or Creator account.
- A Facebook Page connected to that account.
- A Facebook Developer account "with task permissions on the connected Page".
- A Meta app with Basic settings configured, with the **Facebook Login for Business** product added ("use default settings unless implementing manually").

Steps Meta documents (`v25.0` in current examples):

1. Implement login requesting at least `instagram_basic` and `pages_show_list`.
2. `GET https://graph.facebook.com/v25.0/me/accounts?access_token={access-token}` returns Pages where the user has `MANAGE`, `CREATE_CONTENT`, `MODERATE` or `ADVERTISE` permissions.
3. `GET /{page-id}?fields=instagram_business_account` returns the IG User ID. (suprstar collapses steps 2 and 3 into one call using `fields=instagram_business_account,name` on `/me/accounts`.)
4. `GET /{ig-user-id}/media` to read media.

App Dashboard settings that matter for suprstar:

- **App ID / App Secret** go into the card back as Client ID / Client secret.
- **Valid OAuth Redirect URIs** (Facebook Login settings) must contain the exact redirect URI suprstar sends (`{origin}/api/connections/oauth/callback`); it must use HTTPS. See `oauth.md`.
- **Facebook Login for Business** uses `config_id` configurations; the manual `scope` flow that suprstar uses still works ("although scope can still be included, we recommend that you do not use it"). Permissions requested via `scope` that a Facebook Login for Business configuration does not support "will be revoked immediately".

## App modes, access levels and App Review

Source: https://developers.facebook.com/docs/development/build-and-test/app-modes and https://developers.facebook.com/docs/graph-api/overview/access-levels

- **Development mode** (default for new apps): only users with a role on the app (admin, developer, tester) can log in. The app can request permissions "with standard or advanced access levels" from role users. App Review is not required. Test posts made in Development mode are visible only to role users until the app goes Live.
- **Live mode**: anyone can use the app, but the app "must use permissions approved through App Review". App Review is required before switching to Live.
- **Standard Access**: "Permissions with Standard Access can only be requested from app users who have a role on the requesting app." Business apps get Standard Access automatically for all permissions relevant to their type.
- **Advanced Access**: "Permissions with Advanced Access can be requested from any app user." It "is the access level required if your app serves Instagram professional accounts that you don't own or manage." Requires **Business Verification** ("Business Verification is required to get Advanced Access") and App Review for each permission. Apps with Advanced Access must complete an annual Data Use Checkup.

What this means for a suprstar operator:

- If you only publish to your own accounts, keep the app in Development mode, add each Facebook user who will connect as a role user (Roles > Testers/Developers/Admins), and you can use all five scopes without App Review.
- If any connecting user has no role on the app, the login dialog fails or the permissions are silently not granted until the app is Live and the permissions have Advanced Access.

## Graph API versions (date-sensitive)

Source: https://developers.facebook.com/docs/graph-api/changelog

| Version | Released | Available until |
|---|---|---|
| v26.0 (latest) | July 29, 2026 | TBD |
| v25.0 | February 18, 2026 | July 29, 2028 |
| v24.0 | October 8, 2025 | February 18, 2028 |
| v23.0 | May 29, 2025 | October 8, 2027 |
| v22.0 | January 21, 2025 | May 20, 2027 |
| **v21.0 (suprstar)** | October 2, 2024 | **January 21, 2027** |

suprstar's hardcoded `v21.0` stops being served after January 21, 2027; calls will then be auto-upgraded by Meta to the oldest available version, which can change response shapes. The `impressions` insights metric is already "Deprecated for v22.0+" and sunset for all versions on April 21, 2025 (see `publishing.md` / `errors.md`).

## Quotas and rate limits

Source: https://developers.facebook.com/docs/graph-api/overview/rate-limiting, https://developers.facebook.com/docs/instagram-platform/content-publishing, https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit

- **Instagram Platform BUC rate limit**: `4800 * Impressions` calls per 24 hours per app-user pair (Business Use Case rate limit; reported in the `X-Business-Use-Case-Usage` header).
- **Platform (app-level) rate limit**: `200 * Number of Users` calls per hour (reported in `X-App-Usage`).
- **Publishing quota**: the content-publishing guide states "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period" (carousels count as one post). The `content_publishing_limit` reference states `quota_total` is "currently `50`" and `quota_duration` "currently `86400` seconds". The two official pages disagree; treat 50 as the conservative figure and read the live value from `GET /{ig-user-id}/content_publishing_limit` (`data[0].config.quota_total`).
- **Container quota**: "An Instagram account can only create 400 containers within a rolling 24 hour period"; "Containers expire after 24 hours".
- Rate-limit error codes: `4` (app), `17` (user), `32` (Pages), `613` (custom), `80001` (BUC page/system-user token). Publishing-quota error: code `9`, subcode `2207042`, "You reached maximum number of posts that is allowed...". See `errors.md`.

## Sandbox vs live in suprstar

Source: `server/src/platforms/sandbox.ts` (app code). Meta has no sandbox for the Instagram API; suprstar's **Sandbox** mode never calls Meta. Connect, test, publish and metrics are simulated locally and always succeed if Client ID, Client secret and Redirect URI are filled in. Only **Live** mode exercises anything in this folder.
