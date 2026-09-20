---
platform: all
topic: index
sources:
  - https://developers.tiktok.com/
  - https://developers.google.com/youtube
  - https://learn.microsoft.com/linkedin/
  - https://developers.facebook.com/docs/instagram-platform
  - https://docs.x.com/
fetched: 2026-09-19
---

# Platform developer-documentation knowledge base

Offline reference for the platform APIs suprstar publishes to. It exists so the in-app AI agent
(and a human operator) can diagnose connection, account and publishing problems without leaving
the app. Every file is written from the official developer sites listed in its `sources` front
matter and is tied to what the suprstar adapters actually send (`server/src/platforms/*.ts`,
`shared/src/platforms.ts`).

## Index

| Platform | overview | oauth | publishing | errors | troubleshooting |
|---|---|---|---|---|---|
| TikTok | [tiktok/overview.md](tiktok/overview.md) | [tiktok/oauth.md](tiktok/oauth.md) | [tiktok/publishing.md](tiktok/publishing.md) | [tiktok/errors.md](tiktok/errors.md) | [tiktok/troubleshooting.md](tiktok/troubleshooting.md) |
| YouTube | [youtube/overview.md](youtube/overview.md) | [youtube/oauth.md](youtube/oauth.md) | [youtube/publishing.md](youtube/publishing.md) | [youtube/errors.md](youtube/errors.md) | [youtube/troubleshooting.md](youtube/troubleshooting.md) |
| LinkedIn | [linkedin/overview.md](linkedin/overview.md) | [linkedin/oauth.md](linkedin/oauth.md) | [linkedin/publishing.md](linkedin/publishing.md) | [linkedin/errors.md](linkedin/errors.md) | [linkedin/troubleshooting.md](linkedin/troubleshooting.md) |
| Instagram | [instagram/overview.md](instagram/overview.md) | [instagram/oauth.md](instagram/oauth.md) | [instagram/publishing.md](instagram/publishing.md) | [instagram/errors.md](instagram/errors.md) | [instagram/troubleshooting.md](instagram/troubleshooting.md) |
| X | [x/overview.md](x/overview.md) | [x/oauth.md](x/oauth.md) | [x/publishing.md](x/publishing.md) | [x/errors.md](x/errors.md) | [x/troubleshooting.md](x/troubleshooting.md) |

X is served by `server/src/platforms/x.ts` (X API v2 with OAuth 2.0 PKCE). Its troubleshooting file
is written against that adapter's connect, test, publish and metrics calls.

### What each file covers

- `overview.md`: what the API can do, app review / access tiers / sandbox vs production, required app
  permissions and products, quotas.
- `oauth.md`: authorization flow step by step (URLs, parameters, PKCE where used), the scopes suprstar
  requests and what each unlocks, token lifetimes and refresh rules, redirect URI rules, common auth
  errors with exact codes and fixes.
- `publishing.md`: create-post / upload endpoints and request shapes, chunked upload, media
  processing and polling, media requirements, text limits, privacy and audience options, known
  constraints.
- `errors.md`: table of error codes and messages for connect, test, publish and metrics calls with
  meaning and fix, plus rate-limit headers and backoff guidance.
- `troubleshooting.md`: symptom -> likely causes -> what to check in suprstar -> fix. Every platform
  covers the same nine symptoms: connect button loops back, connection test fails, publish fails
  immediately, post stuck processing, post published but not visible, metrics empty, token expired
  every day, duplicate content rejected, rate limited.

## Front matter

Each file starts with a YAML block:

```yaml
---
platform: tiktok | youtube | linkedin | instagram | x
topic: overview | oauth | publishing | errors | troubleshooting
sources:
  - <official URL>
fetched: YYYY-MM-DD
---
```

`fetched` is the date the official pages were last pulled. Anything the pull could not confirm on the
official site is marked "unverified" in the body; treat those statements as hints, not facts.

## How the agent should use this knowledge base

1. Identify the platform from the connection (`connection.platform`) or from the user's wording.
2. Identify the problem area:
   - connect / reconnect / "loops back" / token -> `oauth.md`, then `troubleshooting.md`
   - "Test connection" red -> `troubleshooting.md` (connection test fails), then `errors.md`
   - publish failed / stuck / not visible -> `publishing.md` constraints, `errors.md`, `troubleshooting.md`
   - metrics empty -> `troubleshooting.md` (metrics empty), `overview.md` quotas and permissions
   - rate limit / quota -> `errors.md` rate-limit section, `overview.md` quotas
3. Search by platform + symptom. Headings are plain `##` / `###` so a section splitter can index them;
   the troubleshooting files use the symptom as the `##` heading text, for example
   `## Connect button loops back`.
4. Match the exact error string the app surfaced. suprstar passes the platform's own message through
   (`PlatformError.message` is `error_description`, `error.message` or `message` from the API
   response, falling back to `<Platform> <action> failed (<HTTP status>)`), so the string the user
   sees can be looked up verbatim in `errors.md`.
5. Point the user at the concrete control on the Social Profiles card back. The card back exposes:
   Label; API credentials (Client ID, Client secret, Redirect URI with a suggested value of
   `<origin>/api/connections/oauth/callback`, scope checkboxes); Mode (Sandbox / Live); default post
   settings (format, privacy, auto hashtags, allow comments, plus per-platform fields: Instagram
   business account ID, share reels to feed, first-comment hashtags; TikTok allow duet / stitch;
   YouTube made for kids and category; LinkedIn post as organization and Organization ID); Token
   status with a Refresh token button; Test connection.
6. Prefer the platform's fix over a workaround, and say when a limit is enforced by the platform
   (app review, quota, tier) rather than by suprstar.

### suprstar behaviours that apply to every platform

These come from `server/src/routes/connections.ts` and `server/src/platforms/*.ts` and are repeated in
each troubleshooting file because they explain many symptoms:

- Connect flow: `POST /api/connections/:id/connect` returns `authorizeUrl`; the browser is sent
  there; the platform redirects to `GET /api/connections/oauth/callback?code=...&state=...`; the
  server exchanges the code, fetches the profile, marks the connection `connected` and redirects to
  `/connections?connected=<platform>`. Any failure redirects to `/connections?error=<message>`;
  that `error` query value is the platform's own error text.
- `state` is base64url JSON `{ "connectionId": "..." }`; it is not stored server-side, so a stale
  or edited `state` yields "Unknown connection".
- No PKCE is implemented on any platform today.
- Tokens are never refreshed automatically. Publishing and metrics use the stored access token
  as-is; the only refresh path is the Refresh token button (`POST /api/connections/:id/refresh`).
  An expired access token therefore shows up as a publish or test failure until someone presses
  Refresh or reconnects.
- Test connection (`POST /api/connections/:id/test`) calls the platform's profile endpoint and
  nothing else; a green test proves the access token and profile scope, not the publish scope.
- Sandbox mode short-circuits every call (connect, test, publish, metrics) with simulated data. A
  connection in Sandbox mode never reaches the platform, so a "working" sandbox account says nothing
  about credentials. Switch Mode to Live to exercise the real API.
- Media is served from the suprstar server (`toAbsoluteUrl`). Platforms that pull media by URL
  (TikTok `PULL_FROM_URL`, Instagram `image_url` / `video_url`) need that URL to be publicly
  reachable over HTTPS; a localhost or private-network deployment cannot publish to them.
- `fetchMetrics` returns an empty array for TikTok, YouTube, LinkedIn and Instagram in live mode, so
  "metrics empty" on a live connection is expected behaviour today, not a platform fault.

## Date-sensitive items

Re-check these on every refresh; they are the values most likely to break silently:

- Instagram / Facebook Graph API version hardcoded as `v21.0` in `server/src/platforms/instagram.ts`
  and `shared/src/platforms.ts` (authorize and token URLs). As of the 2026-09-19 pull the latest
  Graph version is v26.0 and v21.0 is available until January 21, 2027; the `impressions` insights
  metric the adapter requests was sunset April 21, 2025. See `instagram/overview.md`.
- LinkedIn `LinkedIn-Version: 202409` hardcoded in `server/src/platforms/linkedin.ts`. As of the
  2026-09-19 pull that version is sunset (September 15, 2025), so every `/rest/images` and
  `/rest/posts` call returns `426 NONEXISTENT_VERSION` while Test connection (unversioned
  `/v2/userinfo`) still passes. See `linkedin/overview.md` for the active version range.
- YouTube Data API quota in `youtube/overview.md`. As of the 2026-09-19 pull the default is a
  separate bucket of 100 `videos.insert` calls/day plus 10,000 units/day for other endpoints; the
  older "1,600 units per upload" figure is obsolete.
- TikTok unaudited-client restrictions and rate limits in `tiktok/overview.md`.
- X access tiers, monthly post caps and per-endpoint limits in `x/overview.md`.
- Every `fetched` date in front matter.

## Refresh procedure

1. Re-run the documentation pull: for each platform, fetch the URLs in that file's `sources` list
   (plus any pages linked from them that the text relies on) using only the official developer sites:
   developers.tiktok.com, developers.google.com/youtube (and developers.google.com/identity),
   learn.microsoft.com/linkedin, developers.facebook.com/docs/instagram-platform (and
   /docs/facebook-login, /docs/graph-api), docs.x.com / developer.x.com.
2. Diff the fetched text against the file; update exact error strings, parameter names, limits,
   version numbers and quota figures. Never write a value from memory without marking it
   "unverified".
3. Re-read `server/src/platforms/*.ts` and `shared/src/platforms.ts` and update the "what suprstar
   does" sections if the adapters changed (endpoints, scopes, headers, hardcoded versions).
4. Set `fetched` in every touched file to the pull date. Keep the `sources` list current; remove
   URLs that no longer resolve and note replacements.
5. If a site blocked the fetch, say so in that file's Sources section and leave the affected
   sections marked "unverified" rather than deleting them.
6. Keep each file under about 600 lines and keep headings as plain `##` / `###` so the section
   splitter keeps working.
