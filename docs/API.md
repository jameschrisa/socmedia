# Pulse API contract

Base URL: `http://localhost:4000/api`. JSON everywhere except uploads (multipart).
All org-scoped routes require header `X-Org-Id: <orgId>` (or `?orgId=`). Missing/unknown org → 400 `{ error }`.
Errors: `{ error: string, details?: unknown }` with 400 (validation), 404, 409, 500.
Types come from `@socmedia/shared` (`shared/src/types.ts`, zod schemas in `shared/src/schemas.ts`).

## Health
- `GET /health` → `{ ok: true, version, time, ai: { configured: boolean, model } }`

## Organizations (not org-scoped)
- `GET /orgs` → `Organization[]`
- `POST /orgs` body `organizationInputSchema` → `Organization` (201). Seeds 4 disconnected sandbox connections for the new org.
- `GET /orgs/:id` → `Organization`
- `PATCH /orgs/:id` body partial `organizationInputSchema` → `Organization`
- `DELETE /orgs/:id` → 204 (refuses to delete the last org: 409)

## Connections (org-scoped) — exactly one connection per platform per org
- `GET /connections` → `PlatformConnection[]` (secrets masked: clientSecret/accessToken/refreshToken returned as `"••••" + last4` or `""`)
- `GET /connections/:id` → `PlatformConnection`
- `PATCH /connections/:id` body `connectionUpdateSchema` → `PlatformConnection`. Masked secret values (starting with `••••`) are ignored so the UI can round-trip.
- `POST /connections/:id/test` → `ConnectionTestResult` and persists it in `lastTest`, updates `status`.
  - sandbox mode: checks clientId/clientSecret/redirectUri present, token present, simulates latency; ok=true when all present.
  - live mode: calls the real platform "who am I" endpoint (see adapters) with the stored access token.
- `POST /connections/:id/connect` → `{ authorizeUrl, state }` builds the real OAuth authorize URL from the platform spec + stored credentials. In sandbox mode ALSO immediately marks the connection connected with a fake account (`displayName`, `handle`, `avatarUrl`, `followers`, fake tokens) and returns `{ authorizeUrl, state, sandbox: true, connection }`.
- `GET /connections/oauth/callback?code&state` (not org scoped; state encodes connectionId) → exchanges code for tokens through the adapter, stores tokens, fetches profile, redirects to `CLIENT_URL/connections?connected=<platform>` (or `?error=`).
- `POST /connections/:id/disconnect` → `PlatformConnection` (tokens cleared, status disconnected, enabled unchanged)
- `POST /connections/:id/refresh` → `PlatformConnection` (refresh token flow; sandbox: extends expiry)

## Media (org-scoped)
- `GET /media` → `MediaAsset[]` newest first
- `POST /media` multipart field `file` (image/* or video/*), optional fields `tags` (comma list), `sourceAssetId`, `format` → `MediaAsset` (201). Images: width/height detected with sharp; a 480px thumbnail is generated. Files stored under `data/uploads/<orgId>/` and served at `/uploads/<orgId>/<file>`.
- `POST /media/export` JSON `{ dataUrl: "data:image/png;base64,...", filename, sourceAssetId?, format?, tags? }` → `MediaAsset` (201). Used by the image editor to save an edited/cropped export.
- `PATCH /media/:id` `{ tags?: string[] }` → `MediaAsset`
- `DELETE /media/:id` → 204

## Posts (org-scoped)
- `GET /posts?from=ISO&to=ISO&status=a,b&platform=x` → `Post[]` (filters on scheduledAt range; drafts without a date are included when no range given or `includeUnscheduled=1`)
- `POST /posts` body `postInputSchema` → `Post` (201). Status defaults: `draft`; if `scheduledAt` provided and status omitted → `scheduled`.
- `GET /posts/:id` → `Post`
- `PATCH /posts/:id` body `postUpdateSchema` → `Post` (used by calendar drag-drop to move `scheduledAt`).
- `DELETE /posts/:id` → 204
- `POST /posts/:id/validate` → `{ issues: ValidationIssue[] }` (uses shared `validatePost` with org media)
- `POST /posts/:id/schedule` `{ scheduledAt }` → `Post` (validates, sets status scheduled; 400 with issues on errors)
- `POST /posts/:id/publish` → `{ post: Post, jobs: PublishJob[] }` publishes immediately through adapters (sandbox: fake externalId/url; live: real API). Post status becomes published / partially_published / failed.
- `POST /posts/:id/duplicate` → `Post` (201, status draft, no scheduledAt)
- `POST /posts/:id/approve` → `Post` (needs_approval → approved, or scheduled if scheduledAt set)

## Jobs (org-scoped)
- `GET /jobs?postId=&status=&limit=` → `PublishJob[]` newest first
- `POST /jobs/:id/retry` → `PublishJob`

## Analytics (org-scoped)
- `GET /analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&platform=` → `AnalyticsSummary` (defaults to last 30 days)
- `POST /analytics/sync` → `{ synced: number }` pulls fresh metrics through adapters for connected connections (sandbox: generates realistic deterministic data for the last 30 days seeded by connectionId).
- `GET /analytics/snapshots?platform=&from=&to=` → `MetricSnapshot[]`

## AI (org-scoped, uses Anthropic SDK; falls back to a deterministic mock when `ANTHROPIC_API_KEY` is absent — response has `mock: true`)
- `POST /ai/captions` body `captionRequestSchema` → `CaptionResponse`
- `POST /ai/ideas` body `ideaRequestSchema` → `IdeaResponse`
- `POST /ai/improve` body `improveRequestSchema` → `{ caption: string, hashtags: string[], model, mock }`
- `POST /ai/hashtags` `{ caption, platform, count? }` → `{ hashtags: string[], model, mock }`
- `POST /ai/best-times` `{ platform }` → `{ slots: { weekday: 0-6, hour: number, score: number }[] }` (derived from metric snapshots; heuristic defaults when none)

## Scheduler
Background loop every `SCHEDULER_INTERVAL_MS` (default 30000) publishes posts whose `status='scheduled'` and `scheduledAt <= now`. Exposed for tests as `runSchedulerTick(db)`.

## Env
`PORT=4000`, `DATA_DIR=./data`, `CLIENT_URL=http://localhost:5173`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-opus-5`, `SCHEDULER_INTERVAL_MS`, `SECRET_KEY` (encrypts stored secrets at rest with AES-256-GCM; default dev key).

## Settings (workspace-wide, not org-scoped)
- `GET /settings/ai` → `AiSettings` (API keys masked). `provider` is the chosen provider; `anthropicFromEnv` is true when the Anthropic key comes from `ANTHROPIC_API_KEY`.
- `PUT /settings/ai` body `aiSettingsUpdateSchema` → `AiSettings`. Masked key values are ignored; `""` clears a key. Keys are encrypted at rest.
- `POST /settings/ai/test` `{ provider: "anthropic" | "moonshot" }` → `AiProviderTestResult` (checks credentials + model availability).
- `GET /settings/ai/models?provider=` → `{ provider, models: string[] }`.
- `GET /health` now reports `ai: { configured, provider, model }` from the active settings. When the chosen provider has no key the AI endpoints fall back to the offline mock.
- Moonshot (Kimi) is called through its OpenAI-compatible endpoint (`https://api.moonshot.ai/v1/chat/completions`, JSON mode) and validated against the same zod schemas as Anthropic's structured outputs.
