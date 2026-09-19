# Pulse — Social Studio

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
