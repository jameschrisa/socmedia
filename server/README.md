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

On first boot the server seeds two organizations (F3i and the "Larkspur Health" demo brand) into
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
| `SECRET_KEY` | dev default (**change in production**) | Used to derive the AES-256-GCM key that encrypts `clientSecret`/`accessToken`/`refreshToken` at rest, and to sign the session cookie |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | _(unset)_ | When both are set and no users exist yet, the server creates the first `owner` account with these credentials on boot (`ensureBootstrapAdmin`, called from `src/index.ts`). Equivalent to completing `POST /auth/setup` by hand. |
| `ADMIN_NAME` | `Owner` | Display name for the bootstrap admin |

## Authentication & users

Every `/api` route except `GET /health`, `GET /auth/status`, `GET /auth/me`, `POST /auth/setup`,
`POST /auth/login` and `GET /connections/oauth/callback` requires a signed-in user (`/uploads/*` also
stays public). Sign-in sets an httpOnly cookie (`suprstar_session`, `SameSite=Lax`, `Secure` in
production, 30 days) whose value is a session id signed with `SECRET_KEY` (HMAC-SHA256); the session
itself lives in the `sessions` table and is cleaned up lazily on lookup. Passwords are hashed with
`node:crypto` scrypt (per-user salt, timing-safe comparison) in `src/services/auth.ts`.

Roles, from least to most privileged: `viewer` (read-only within their orgs) < `editor` (create/edit/
publish within their orgs) < `admin` < `owner` (both manage users, organizations and workspace settings,
and can access every org). Org-scoped routes additionally check membership (`orgIds` includes the org,
or `orgIds === "*"`) and return 403 otherwise. `/settings/*`, `/users/*`, org create/update/delete and
connection create/delete/credentials all require `admin`+; owners cannot be demoted or deactivated by an
admin, and the last active owner can never be removed. See `docs/API.md` for the full route-by-route
breakdown.

In tests, `createTestContext()` seeds an `owner` user and points `config.testAuthUserId` at them so
existing `supertest(ctx.app)` calls (no cookie) keep working; call `ctx.disableAuthBypass()` to exercise
real 401/403/login flows with `supertest.agent(ctx.app)`.

## Video

Uploads and clips are processed with `ffmpeg-static`/`ffprobe-static` (`src/services/video.ts`). Video
uploads are probed for duration/width/height and get a JPEG poster frame (`thumbnailUrl`) at 1s (or 0s
if shorter); uploads over `VIDEO_MAX_SECONDS` (300s, from `@socmedia/shared`) are rejected with 400.
`POST /media/:id/clip` trims (and optionally crops/mutes) a video with ffmpeg, either as a new derived
asset (`mode: "new"`) or in place (`mode: "replace"`).

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

- SQLite tables: `organizations`, `connections`, `media`, `posts`, `publish_jobs`, `metric_snapshots`,
  `users`, `sessions`. JSON-shaped fields (credentials, settings, targets, hashtags, tags, labels, log,
  `orgIds`) are stored as `TEXT` and parsed/serialized in `src/db/repositories/*.ts`. `users.orgIds` is
  either the literal string `"*"` or a JSON array of org ids; `users.email` has a `UNIQUE COLLATE NOCASE`
  index.
- Secrets (`clientSecret`, `accessToken`, `refreshToken`) are encrypted at rest with AES-256-GCM
  (`src/crypto.ts`), keyed off `SECRET_KEY`, and only ever returned to clients masked
  (`"" ` or `"••••" + last4`). `PATCH` requests that echo a masked value back are ignored, so the UI can
  safely round-trip a connection's settings without ever seeing the real secret.
