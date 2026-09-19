# Pulse API server

Express + SQLite (via Node's built-in `node:sqlite`) API implementing `docs/API.md`. See that file for
the full REST contract. This document covers running it, environment variables, and how sandbox vs.
live mode work for each platform.

## Running

```bash
npm run dev -w server      # tsx watch, http://localhost:4000
npm run build -w server    # tsc -> server/dist
npm run start -w server    # node dist/index.js (after build)
npm run test -w server     # vitest
npm run typecheck -w server
```

On first boot the server seeds two demo organizations ("Holistiplan" and "Northstar Advisors") into
`DATA_DIR/pulse.db` if the database is empty. Seeding is skipped whenever any organization already
exists, so it's safe to restart the server repeatedly.

## Environment variables

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `DATA_DIR` | `./data` | Where `pulse.db` and `uploads/<orgId>/...` live |
| `CLIENT_URL` | `http://localhost:5173` | Used for CORS and OAuth callback redirects |
| `PUBLIC_BASE_URL` | _(unset)_ | Publicly reachable base URL for this server, used when a live platform adapter needs a fetchable media URL (TikTok `PULL_FROM_URL`, Instagram `image_url`/`video_url`). Falls back to `http://localhost:$PORT`, which only works for platforms that can reach your machine (e.g. via a tunnel). |
| `ANTHROPIC_API_KEY` | _(unset)_ | When unset, all `/api/ai/*` routes use the deterministic mock generator (`mock: true` in every response) |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Passed to the Anthropic SDK |
| `SCHEDULER_INTERVAL_MS` | `30000` | How often the background scheduler checks for due scheduled posts |
| `SECRET_KEY` | dev default (**change in production**) | Used to derive the AES-256-GCM key that encrypts `clientSecret`/`accessToken`/`refreshToken` at rest |

## Sandbox vs. live mode

Every connection has a `mode`: `"sandbox"` (default) or `"live"`.

- **Sandbox** never calls a real platform API. `connect` immediately marks the connection connected
  with a fake account (`sb_access_*` tokens, deterministic follower counts, dicebear avatar),
  `publish` returns fake ids/URLs shaped like the real platform's (e.g.
  `https://www.tiktok.com/@handle/video/<id>`), and `fetchMetrics` returns deterministic pseudo-random
  data seeded by the connection id (same connection -> same numbers every time). This is what the
  automated test suite and the seeded demo data use.
- **Live** mode calls the real platform APIs in `src/platforms/{tiktok,youtube,linkedin,instagram}.ts`
  using the connection's stored credentials/tokens. You must supply real OAuth credentials (see below)
  and complete the OAuth flow via `POST /connections/:id/connect` -> redirect through
  `GET /connections/oauth/callback` before publishing will work.

Switch a connection's mode with `PATCH /connections/:id { "mode": "live" }`.

## Getting OAuth credentials per platform

### TikTok
1. Create an app in the [TikTok for Developers portal](https://developers.tiktok.com/).
2. Add the **Login Kit** and **Content Posting API** products.
3. Copy the app's **Client Key** and **Client Secret** into the connection's credentials
   (`clientId` = Client Key).
4. Add your redirect URI (e.g. `https://your-domain.com/api/connections/oauth/callback`) to the app's
   allow-list and set it as `redirectUri` on the connection.
5. Note: TikTok content posting requires the app to pass review before it can publish to accounts
   outside your registered test users.

### YouTube (Google Cloud / YouTube Data API v3)
1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **YouTube Data API v3**.
3. Configure an OAuth consent screen, then create an **OAuth 2.0 Client ID** (type: Web application).
4. Add `https://your-domain.com/api/connections/oauth/callback` as an authorized redirect URI.
5. Use the client ID/secret as `clientId`/`clientSecret`. Scopes requested are
   `youtube.upload`, `youtube.readonly`, and `yt-analytics.readonly`.

### LinkedIn
1. Create an app at the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps).
2. Request the **Share on LinkedIn** and **Community Management API** products (the latter requires
   approval for organization posting).
3. Add your redirect URL under "Auth" -> "OAuth 2.0 settings".
4. Use the app's Client ID/Secret as `clientId`/`clientSecret`. To post as a company Page rather than a
   personal profile, set `settings.postAsOrganization = true` and store the organization's numeric id
   in `credentials.extra.organizationId`.

### Instagram (Meta Graph API)
1. Create an app at [developers.facebook.com](https://developers.facebook.com/apps/) (type: Business).
2. Add the **Instagram Graph API** product.
3. You need a Facebook Page with an Instagram **Business** (or Creator) account linked to it — personal
   Instagram accounts cannot publish via the API.
4. Add your redirect URI under the app's Facebook Login settings.
5. Use the app's Client ID/Secret as `clientId`/`clientSecret`. After connecting, the server looks up
   the linked Page's Instagram Business Account id via `/me/accounts` and stores it in
   `credentials.extra.igUserId`.

## Data model notes

- SQLite tables: `organizations`, `connections`, `media`, `posts`, `publish_jobs`, `metric_snapshots`.
  JSON-shaped fields (credentials, settings, targets, hashtags, tags, labels, log) are stored as `TEXT`
  and parsed/serialized in `src/db/repositories/*.ts`.
- Secrets (`clientSecret`, `accessToken`, `refreshToken`) are encrypted at rest with AES-256-GCM
  (`src/crypto.ts`), keyed off `SECRET_KEY`, and only ever returned to clients masked
  (`"" ` or `"••••" + last4`). `PATCH` requests that echo a masked value back are ignored, so the UI can
  safely round-trip a connection's settings without ever seeing the real secret.
