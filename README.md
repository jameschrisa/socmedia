# suprstar — Social Studio

Plan, publish and monitor TikTok, YouTube, LinkedIn and Instagram from one place, organised by organization.

## Features

- **Social Profiles** — one flip card per platform. Front: enable toggle, connected account, connection test with a per-check report, connect / disconnect. Back: API credentials (client id/secret, redirect URI, scopes), sandbox vs live mode, default post settings per network, token status and refresh.
- **Calendar** — month and week views. Drag creatives or drafts from the sidebar onto a day, pick a time with the iOS-style wheel scroller, move scheduled posts between days, approve, publish now, duplicate, delete. Best-time suggestions per platform.
- **Studio** — media library with upload, tags and a Konva image editor: crop to platform presets (1:1, 4:5, 9:16, 16:9, 1.91:1), zoom, rotate, brightness/contrast/saturation/blur, text overlays and brand badge. Exports are saved as derived assets per format.
- **Composer** — per-platform targets with their own aspect format, caption/title overrides, live previews framed like each network, shared validation rules (caption limits, hashtag limits, media kinds, video length, YouTube titles), schedule with date + time wheel, approvals, publish now.
- **AI Assistant (Claude)** — captions per platform with hooks and hashtags, content ideas, hashtag suggestions, caption improvement and best posting times. Runs against the Anthropic API when `ANTHROPIC_API_KEY` is set and falls back to an offline mock otherwise.
- **Analytics & monitoring** — KPIs, impressions, engagement and follower charts per platform, top posts, live publish log with retry.
- **Video clips** — upload videos up to 5 minutes; the server probes them with ffprobe and stores a poster frame. The Studio clip editor trims a range with dual handles or timecodes, crops to a platform format, mutes audio and saves the result as a new clip or replaces the original.
- **Multiple accounts per platform** — connect several TikTok, Instagram, YouTube or LinkedIn accounts per organization, pick which accounts a post goes to, and publish to all of them at once or in a spaced queue.
- **Organizations** — switch between organizations from the header; each has its own connections, media, posts and metrics. Demo organizations (Larkspur Health, Enel Health) can be created from Settings with realistic placeholder content.
- **Console** — a terminal drawer on every page (right rail button or Ctrl+`) streaming the live activity log (HTTP, auth, scheduler, publishing, media) with level/source/text filters, plus a log-file viewer for admins. Its prompt takes slash commands (`/status`, `/posts`, `/jobs`, `/publish <id>`, `/retry <id>`, `/logs`, `/docs <platform?> <query>`, `/diagnose <connectionId|platform>`) or plain-language requests that the Claude agent carries out with tools (list, create, schedule, publish and retry posts, pull analytics, draft captions, search the platform docs, diagnose a connection). Owners and admins also get a real OS terminal in the same drawer (`OS_TERMINAL=on`, the default outside production) — a login shell to the host, over a WebSocket, with a native pty when available and a plain-pipe fallback otherwise. The agent's platform-docs search reads the offline developer-documentation knowledge base at `docs/platforms/` (OAuth flows, publishing limits, exact error strings, troubleshooting) so it can cite the right file and source URL when a connection is broken, instead of guessing.
- **Quick post from your phone** (advanced) — create a private link in Settings, open it on your phone, take a photo, type a caption or record a voice memo (transcribed on-device), and it posts straight to the chosen accounts and shows the live link for each one. Works from iOS Shortcuts too.
- **Inbound messaging** (advanced) — link a phone number (Twilio SMS/WhatsApp) or a Telegram bot to a user and a set of accounts from Settings; texting the linked number/bot a photo with a caption (or a voice note, transcribed server-side via OpenAI/Deepgram when configured) posts it through the same pipeline as Quick Post, with an optional "reply YES to post" confirmation step and `/status`-style slash commands handled by the same agent as the Console. A signed-in "test" channel drives the setup wizard without needing real Twilio/Telegram credentials.
- **Post from chat** — connect a Twilio number (SMS, MMS, WhatsApp) or a Telegram bot, link a phone with a one-time code, then text a photo with a caption to publish without opening the app; confirmations with live links come back in the chat, and every message is tracked in Settings and the Console.
- **Users & access** — sign-in required. Roles are owner, admin, editor and viewer; owners and admins invite users from Settings → Users & access, scope them to organizations, deactivate or remove them. Viewers are read-only.
- **Scheduler** — server-side loop publishes due posts through platform adapters. Every connection runs in *sandbox* mode (simulated publishing) until you switch it to *live* with real credentials.

## Stack

- `shared/` — TypeScript types, zod schemas, platform specs and validation shared by both sides.
- `server/` — Express + SQLite (`node:sqlite`), platform adapters (TikTok Content Posting API, YouTube Data API v3, LinkedIn Posts API, Instagram Graph API), Anthropic SDK, scheduler, media processing with sharp.
- `client/` — Vite + React 18 + TypeScript, Tailwind, Framer Motion (animation), dnd-kit (drag and drop), Konva (image editing), Recharts, TanStack Query, Zustand.

## Run

```bash
npm install
cp .env.example .env      # bootstrap owner, Google client, mail provider, optional ANTHROPIC_API_KEY
npm run dev               # API on :4000, web on :5173; the API dev script loads the root .env
```

The database is seeded on first start with F3i plus two demo organizations (Larkspur Health and Enel Health, each with its logo), sandbox connections, sample media, posts and 30 days of metrics.

Sign-in: set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (and optionally `ADMIN_NAME`) before the first start to create the owner account. Without them, the sign-in page offers a one-time "create the first owner" form until an owner exists. Owners invite everyone else from Settings → Users & access; invited users get a temporary password and must change it on first sign-in.

## Test

```bash
npm test                  # unit + integration (shared, server, client)
npm run typecheck
npm run build
npm run test:e2e          # Playwright smoke tests (starts API + web)
```

## Going live

See `server/README.md` for how to create OAuth apps on each platform and what redirect URI to register. Switch a connection to **Live** on the back of its card, save credentials, then use **Connect** to run the OAuth flow.

## Deploy

The server keeps SQLite, uploads and the scheduler on local disk, so it needs a persistent Node host. The client is static and can live anywhere, including Vercel.

### API (Docker)

```bash
docker build -f server/Dockerfile -t pulse-api .
docker run -d -p 4000:4000 -v pulse-data:/data \
  -e SECRET_KEY=change-me -e CLIENT_URL=https://your-app.vercel.app \
  -e PUBLIC_BASE_URL=https://api.your-domain.com pulse-api
```

Or `docker compose up -d` for a local production run. The image also serves the built client from `client/dist`, so one container can run the whole app. Mount `/data` on a persistent volume: it holds the database, media and logos. Railway, Render and Fly.io all build this Dockerfile directly; set the build context to the repository root.

Auto-deploy: Render only receives GitHub webhooks when the repository is connected through its GitHub app (Render dashboard → service → Settings → connect GitHub). Until then, trigger deploys with `POST https://api.render.com/v1/services/<serviceId>/deploys` using a Render API key.

One-click hosts: `render.yaml` (Render Blueprint with a 5 GB disk at `/data`), `fly.toml` (Fly.io with a volume) and `railway.json` (Railway; add a volume mounted at `/data` in the dashboard) are included. After the first deploy, set `PUBLIC_BASE_URL` to the service URL and put that same host into the `vercel.json` rewrites.

Environment: `PORT`, `DATA_DIR`, `SECRET_KEY` (encrypts stored credentials and signs session cookies), `CLIENT_URL` (CORS and OAuth redirects), `PUBLIC_BASE_URL` (Instagram and TikTok fetch media from this URL in live mode), `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` (bootstrap owner), optional `ANTHROPIC_API_KEY`. Sign-in: `ROOT_ADMIN_EMAILS` (comma-separated emails that are always owners over every organization and cannot be demoted, narrowed or deleted from inside the app), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google SSO), `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` / `ENTRA_TENANT_ID` (Microsoft Entra ID SSO; tenant defaults to `organizations`), `MAIL_PROVIDER` (`resend` | `smtp` | `log`, default `log`), `MAIL_FROM`, `RESEND_API_KEY`, `SMTP_URL` (see docs/API.md "Authentication & users" for magic links, Google SSO, Entra ID SSO, the mail self-test, the access policy and access requests). Video processing uses the bundled `ffmpeg-static` and `ffprobe-static` binaries, so no system ffmpeg is needed. Register each platform's OAuth redirect URI as `<PUBLIC_BASE_URL>/api/connections/oauth/callback`, and Entra's redirect URI as `<CLIENT_URL>/api/auth/entra/callback`.

### Backups

The API takes its own backups: a gzipped tar of a consistent SQLite snapshot plus the `uploads/` tree, written to `<DATA_DIR>/backups` on a schedule (`BACKUP_INTERVAL_HOURS`, default 24), rotated locally (`BACKUP_KEEP`, default 7) and optionally mirrored to S3-compatible storage (`BACKUP_S3_BUCKET` + friends). Manage them from `GET/POST/DELETE /api/backups` (owner/admin) or `GET /api/backups/:name` to download one. See docs/API.md "Backups" for the full env var list, archive layout and endpoints.

To restore: `node scripts/fetch-backup.mjs [outputDir]` (only if you need to pull the archive down from S3-compatible storage first), then `node scripts/restore-backup.mjs <archive.tar.gz> <dataDir> --dry-run` to preview, then the same command with `--force` to actually restore, then restart the service. It moves the existing data directory aside (`<dataDir>.pre-restore-<timestamp>`) instead of deleting it.

### Client (Vercel)

Import the repo and leave **Root Directory** at the repository root: the root `vercel.json` installs the workspaces, builds the client and publishes `client/dist`, with the SPA fallback and cache headers. (If you prefer Root Directory `client`, `client/vercel.json` provides the same settings for the Vite preset.) The rewrites proxy `/api` and `/uploads` to the Render service `suprstar-api.onrender.com`; change them if the API moves.
