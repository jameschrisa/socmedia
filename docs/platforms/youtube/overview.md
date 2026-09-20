---
platform: youtube
topic: overview
sources:
  - https://developers.google.com/youtube/v3/getting-started
  - https://developers.google.com/youtube/v3/determine_quota_cost
  - https://developers.google.com/youtube/v3/revision_history
  - https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
  - https://developers.google.com/youtube/v3/guides/authentication
  - https://developers.google.com/youtube/v3/guides/auth/installed-apps
  - https://developers.google.com/youtube/terms/developer-policies
  - https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
  - https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
  - https://developers.google.com/youtube/analytics/reference/reports/query
fetched: 2026-09-19
---

# YouTube: platform overview for suprstar

## What suprstar uses on YouTube

Adapter: `server/src/platforms/youtube.ts`. Spec: `shared/src/platforms.ts` (`PLATFORM_SPECS.youtube`).

| Capability | API used by suprstar | Status in app |
|---|---|---|
| Connect account | Google OAuth 2.0 web-server flow (`https://accounts.google.com/o/oauth2/v2/auth`, token endpoint `https://oauth2.googleapis.com/token`) | Implemented, no PKCE |
| Connection test / profile | YouTube Data API v3 `channels.list?part=snippet,statistics&mine=true` | Implemented |
| Publish | YouTube Data API v3 `videos.insert` with `uploadType=multipart` and `part=snippet,status` | Implemented (single request, whole file in memory, no resumable upload, no retry, no processing poll) |
| Metrics | YouTube Analytics API `reports.query` | Not implemented; `fetchMetrics` returns `[]` even though the `yt-analytics.readonly` scope is requested |
| Token refresh | `grant_type=refresh_token` on the Google token endpoint | Manual only (card-back "Refresh token" button); no automatic refresh before publish |

Media accepted by the app for YouTube: video only, one file per post, formats `landscape_16_9` (default) and `portrait_9_16`, caption max 5000 chars, title max 100 chars, hashtag limit 15, `maxVideoSeconds` 43200 (12 h).

Sandbox mode (`mode: "sandbox"` on the connection) bypasses every Google call and fabricates tokens, profile, publish IDs and metrics. Nothing in this folder applies to sandbox connections.

## What the APIs can do

Source: https://developers.google.com/youtube/v3/getting-started

- YouTube Data API v3: read and write channel, video, playlist, comment, caption and thumbnail resources on behalf of an authorised Google account. suprstar uses `channels.list` and `videos.insert`.
- YouTube Analytics API v2: query aggregated channel/video metrics (`views`, `estimatedMinutesWatched`, `likes`, `comments`, `shares`, `subscribersGained`, ...) with dimensions such as `day` or `video`. Requires the `yt-analytics.readonly` scope. Source: https://developers.google.com/youtube/analytics/reference/reports/query
- Service accounts are not supported: "While OAuth 2.0 includes a service account flow, the YouTube Data API does not support this method, and using it will result in a `NoLinkedYouTubeAccount` error." Source: https://developers.google.com/youtube/v3/guides/authentication

## Required Google Cloud setup

Source: https://developers.google.com/youtube/v3/getting-started and https://developers.google.com/identity/protocols/oauth2/web-server

1. A Google Cloud project with **YouTube Data API v3** enabled (APIs & Services > Library). For metrics, also enable **YouTube Analytics API**.
2. An OAuth consent screen (user type External for third-party creators).
3. An OAuth 2.0 Client ID of type **Web application**. Its **Client ID** and **Client secret** go into the suprstar card back; suprstar's callback (`<origin>/api/connections/oauth/callback`) must be listed verbatim under **Authorized redirect URIs**.
4. No separate "product" or "permission" must be added in the console; access is controlled purely by OAuth scopes granted by the user (see `oauth.md`).

## App verification, publishing status and user caps

Sources: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification, https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification, https://developers.google.com/youtube/v3/guides/auth/installed-apps

- YouTube scopes are **sensitive** scopes: "Sensitive scopes require review by Google before any Google Account can grant access." The verification page uses "deleting a YouTube video" as its example of a sensitive action.
- Consent screen **publishing status**:
  - `Testing`: "your app is still in development and is only available to users you add to the list of test users." Testing apps "are still subject to a tester warning screen ... a user cap is in effect, and the refresh token lifetime is limited." The refresh-token limit for Testing is **7 days** (see `oauth.md`).
  - `In production`: publicly available, but if it requests sensitive/restricted scopes it must pass verification or users see the **unverified app** screen. "If you see **unverified app** on the screen when testing your application, you must submit a verification request to remove it."
- "A user cap restricts the number of Google Accounts able to grant access to your unverified app." The exact number (commonly cited as 100) is documented on support.google.com/cloud/answer/7454865, which is not a developers.google.com page; treat "100" as **unverified** here.
- Verification requirements: privacy policy linked on the consent screen, publicly accessible homepage, domain ownership verified in Search Console, and a demo video showing the OAuth grant and use of each sensitive scope.

## YouTube API compliance audit and the private-video lock

Sources: https://developers.google.com/youtube/v3/revision_history, https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits

- Revision history, July 28 2020: "All videos uploaded via the `videos.insert` endpoint from unverified API projects created after 28 July 2020 will be restricted to private viewing mode." The restriction is lifted only after the project passes the **YouTube API Services compliance audit** ("YouTube API Services - Audit and Quota Extension Form").
- Revision history, July 1 2021: "All developers using YouTube's API Services must complete an API Compliance Audit in order to be granted more than the default quota allocation of 10,000 units."
- Practical consequence for suprstar: a new Cloud project can upload successfully (HTTP 200, video ID returned) yet every upload stays `private` regardless of the `privacyStatus` sent. This is the most common cause of "published but not visible" on YouTube. See `troubleshooting.md`.

## Quotas (date-sensitive)

Sources: https://developers.google.com/youtube/v3/getting-started, https://developers.google.com/youtube/v3/determine_quota_cost, https://developers.google.com/youtube/v3/revision_history

Quota model as of 2026-09-19 (changed twice recently, so re-check on refresh):

- "Projects that enable the YouTube Data API have a default quota allocation of 100 `search.list` calls, 100 `videos.insert` calls, and 10,000 units per day combined for all other endpoints."
- Revision history, December 4 2025: "the quota cost of a video upload [changed] from approximately 1600 units to approximately 100 units."
- Revision history, June 1 2026: "API calls to the `videos.insert` and `search.list` methods will be charged to their own respective quota buckets."
- `videos.insert`: "100 calls per day" with "a quota cost of 1 unit in the Video Uploads quota bucket".
- `channels.list`: 1 unit. `videos.list`: 1 unit. `videos.update`: 50 units. `thumbnails.set`: 50 units. `captions.insert`: 400 units.
- "Every API request costs a minimum of 1 quota point, including invalid requests."
- "Daily quotas reset at midnight Pacific Time (PT)."
- More quota: "you can request additional quota by completing the Quota extension request form for YouTube API Services" (https://support.google.com/youtube/contact/yt_api_form); requires the compliance audit.
- Older material (and older suprstar notes) that says "1,600 units per upload" is obsolete since 2025-12-04.

Per-suprstar arithmetic: each publish = 1 upload-bucket call; each connection test = 1 unit; a channel-wide cap of 100 API uploads per day per Cloud project applies across all connections that share the same Client ID.

## Developer policy items that affect the app

Source: https://developers.google.com/youtube/terms/developer-policies

- III.C.3: "users must have final control over the data that will be published to YouTube Applications" (the composer must show what will be uploaded).
- III.E.4.a: "API Clients may store authorization tokens for as long as necessary provided tokens are used only for purposes consistent with specific consent".
- III.E.4.c: stored Authorized Data other than tokens may be kept "for no longer than 30 calendar days. After 30 calendar days, the API Client must either delete or refresh the stored data." (Relevant if suprstar caches channel stats/followers.)
- III.H: YouTube may audit the production app on request.

## Sandbox vs production

There is no Google-hosted sandbox for the YouTube Data API. Testing is done with a real channel while the consent screen is in `Testing` status (test users only, 7-day refresh tokens). suprstar's own `sandbox` mode is a local simulation and does not exercise Google at all.
