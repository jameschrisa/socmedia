# suprstar — Social Studio

Plan, publish and monitor TikTok, YouTube, LinkedIn and Instagram from one place, organised by organization.

## Features

- **Social Profiles** — one flip card per platform. Front: enable toggle, connected account, connection test with a per-check report, connect / disconnect. Back: API credentials (client id/secret, redirect URI, scopes), sandbox vs live mode, default post settings per network, token status and refresh.
- **Calendar** — month and week views. Drag creatives or drafts from the sidebar onto a day, pick a time with the iOS-style wheel scroller, move scheduled posts between days, approve, publish now, duplicate, delete. Best-time suggestions per platform.
- **Studio** — media library with upload, tags and a Konva image editor: crop to platform presets (1:1, 4:5, 9:16, 16:9, 1.91:1), zoom, rotate, brightness/contrast/saturation/blur, text overlays and brand badge. Exports are saved as derived assets per format.
- **Composer** — per-platform targets with their own aspect format, caption/title overrides, live previews framed like each network, shared validation rules (caption limits, hashtag limits, media kinds, video length, YouTube titles), schedule with date + time wheel, approvals, publish now.
- **AI Assistant (Claude)** — captions per platform with hooks and hashtags, content ideas, hashtag suggestions, caption improvement and best posting times. Runs against the Anthropic API when `ANTHROPIC_API_KEY` is set and falls back to an offline mock otherwise.
- **Analytics & monitoring** — KPIs, impressions, engagement and follower charts per platform, top posts, live publish log with retry.
- **Organizations** — switch between organizations from the header; each has its own connections, media, posts and metrics.
- **Scheduler** — server-side loop publishes due posts through platform adapters. Every connection runs in *sandbox* mode (simulated publishing) until you switch it to *live* with real credentials.

## Stack

- `shared/` — TypeScript types, zod schemas, platform specs and validation shared by both sides.
- `server/` — Express + SQLite (`node:sqlite`), platform adapters (TikTok Content Posting API, YouTube Data API v3, LinkedIn Posts API, Instagram Graph API), Anthropic SDK, scheduler, media processing with sharp.
- `client/` — Vite + React 18 + TypeScript, Tailwind, Framer Motion (animation), dnd-kit (drag and drop), Konva (image editing), Recharts, TanStack Query, Zustand.

## Run

```bash
npm install
cp .env.example .env      # optionally add ANTHROPIC_API_KEY
npm run dev               # API on :4000, web on :5173
```

The database is seeded on first start with two demo organizations, sandbox connections, sample media, posts and 30 days of metrics.

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

Environment: `PORT`, `DATA_DIR`, `SECRET_KEY` (encrypts stored credentials), `CLIENT_URL` (CORS and OAuth redirects), `PUBLIC_BASE_URL` (Instagram and TikTok fetch media from this URL in live mode), optional `ANTHROPIC_API_KEY`. Register each platform's OAuth redirect URI as `<PUBLIC_BASE_URL>/api/connections/oauth/callback`.

### Client (Vercel)

Import the repo and leave **Root Directory** at the repository root: the root `vercel.json` installs the workspaces, builds the client and publishes `client/dist`, with the SPA fallback and cache headers. (If you prefer Root Directory `client`, `client/vercel.json` provides the same settings for the Vite preset.) The rewrites proxy `/api` and `/uploads` to the Render service `suprstar-api.onrender.com`; change them if the API moves.
