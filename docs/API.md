# Pulse API contract

Base URL: `http://localhost:4000/api`. JSON everywhere except uploads (multipart).
All org-scoped routes require header `X-Org-Id: <orgId>` (or `?orgId=`). Missing/unknown org → 400 `{ error }`.
Errors: `{ error: string, details?: unknown }` with 400 (validation), 404, 409, 500.
Types come from `@socmedia/shared` (`shared/src/types.ts`, zod schemas in `shared/src/schemas.ts`).

## Authentication & users
All `/api` routes except `GET /health`, `GET /auth/status`, `GET /auth/me`, `POST /auth/setup`, `POST /auth/login` and `GET /connections/oauth/callback` require a signed-in user. `/uploads/*` stays public because the platforms pull media from those URLs in live mode. (`GET /auth/me` is listed separately below as "never 401"; it is implemented as a public route so signed-out clients can poll it without special-casing.)
Sessions: `POST /auth/login` sets an httpOnly cookie `suprstar_session` (SameSite=Lax, Secure in production, 30 days). Unauthenticated requests get 401 `{ error: "Sign in required" }`; forbidden ones 403.
Roles (`shared/src/types.ts` `ROLE_CAPABILITIES`): `owner` and `admin` manage users, organizations and workspace settings and can access every org; `editor` can create/edit/publish within their orgs; `viewer` is read-only (GET) within their orgs. Org-scoped routes check membership (`orgIds` includes the org, or `"*"`) → 403 otherwise. Mutating routes (POST/PATCH/PUT/DELETE) require `editor` or above; `/settings/*`, `/users/*`, org create/update/delete and connection create/delete/credentials require `admin`+. Owners cannot be demoted or deactivated by admins; the last active owner cannot be removed.
- `GET /auth/status` (public) → `{ needsSetup: boolean, authenticated: boolean }`
- `POST /auth/setup` (public, only while no users exist, else 409) body `setupSchema` → creates the first `owner` with `orgIds: "*"`, signs them in, returns `AuthState`. Env `ADMIN_EMAIL` + `ADMIN_PASSWORD` (+ optional `ADMIN_NAME`) create this owner automatically on boot when no users exist.
- `POST /auth/login` body `loginSchema` → `AuthState` (401 on bad credentials or inactive user; updates `lastLoginAt`)
- `POST /auth/logout` → 204 (clears the cookie, deletes the session)
- `GET /auth/me` → `AuthState` (`authenticated: false` when signed out; never 401)
- `POST /auth/password` body `changePasswordSchema` → 204 (clears `mustChangePassword`)
- `GET /users` (admin+) → `User[]` (never includes password hashes)
- `POST /users` (admin+) body `userCreateSchema` → `User` (201) with `mustChangePassword: true`; 409 on duplicate email; admins may not create owners.
- `PATCH /users/:id` (admin+) body `userUpdateSchema` → `User`; setting `password` marks `mustChangePassword`. Rules above apply.
- `DELETE /users/:id` (admin+) → 204 (also ends their sessions). Cannot delete yourself or the last active owner.
- Passwords are hashed with scrypt (`node:crypto`), sessions stored in a `sessions` table with an expiry and cleaned lazily.

## Health
- `GET /health` → `{ ok: true, version, time, ai: { configured: boolean, model } }`

## Organizations (not org-scoped)
Every mutating method under `/orgs` (POST/PATCH/DELETE, including the demo-seeding endpoints) requires `admin`+, same as org create/update/delete/logo; `GET` endpoints only require a signed-in user.
- `GET /orgs` → `Organization[]`
- `POST /orgs` body `organizationInputSchema` → `Organization` (201). Seeds 4 disconnected sandbox connections for the new org.
- `POST /orgs/demo` also accepts identity overrides `{ profile, name?, slug?, handle?, brandColor?, timezone? }` so one content profile can seed several brands.
- `GET /orgs/demo/profiles` → available demo content profiles `{ key, name, brandColor, posts }[]`
- `POST /orgs/demo` `{ profile }` → creates a new organization filled with that profile's demo content (201)
- `POST /orgs/:id/demo` `{ profile }` → fills an existing organization with demo content
- `GET /orgs/:id` → `Organization`
- `PATCH /orgs/:id` body partial `organizationInputSchema` → `Organization`
- `DELETE /orgs/:id` → 204 (refuses to delete the last org: 409)

## Connections (org-scoped) — one or more accounts per platform
- `POST /connections` body `connectionCreateSchema` `{ platform, label?, mode?, copyCredentialsFrom? }` → `PlatformConnection` (201). Adds another account on a platform; `copyCredentialsFrom` copies app credentials (client id/secret, redirect URI, scopes) from a sibling account, never its tokens.
- `DELETE /connections/:id` → 204. The last account on a platform cannot be deleted (409).
- `GET /connections` → `PlatformConnection[]` (each has a `label` to tell accounts apart) (secrets masked: clientSecret/accessToken/refreshToken returned as `"••••" + last4` or `""`)
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
- Video uploads are probed with ffprobe (`ffprobe-static`); duration, width and height are stored and a poster frame at 1s is saved as `thumbnailUrl`. Uploads longer than `VIDEO_MAX_SECONDS` (300s) are rejected with 400 `Videos must be 5 minutes or shorter (this one is M:SS)`.
- `POST /media/:id/clip` (video assets only) JSON `clipRequestSchema` `{ start, end, format?, mode: "new"|"replace", muted? }` → `MediaAsset` (201 for `new`, 200 for `replace`). Trims with ffmpeg (`ffmpeg-static`, H.264/AAC, `-movflags +faststart`), optionally scales and centre-crops to `FORMAT_SPECS[format]` (e.g. 1080×1920 for 9:16), strips audio when `muted`. New clips get `sourceAssetId` = original, tags include `clip`, filename `<base>-clip-<start>s-<end>s.mp4`. Replace keeps the id and deletes old files. Clips are validated to ≤ 300s and ≥ 0.5s and must lie within the source duration (400 otherwise).
- `PUT /media/:id/replace` JSON `{ dataUrl, format? }` → `MediaAsset`: overwrites the asset's file in place (same id); used by the image editor's Save. Old files are deleted.
- `POST /media/:id/duplicate` → `MediaAsset` (201): clones the asset with copied files and `sourceAssetId` set to the original.
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

### Multi-account publishing
Posts carry `publishMode` (`all` | `queue`) and `queueSpacingMinutes`. In `all` mode every target account is published immediately, each as an isolated job. In `queue` mode the first account publishes immediately and the rest get deferred jobs with `runAt` spaced by `queueSpacingMinutes`; the scheduler runs them when due. Publishing is idempotent per (post, account): accounts with a succeeded job are skipped on re-runs. `validatePost` warns when several accounts on one platform would post an identical caption at once.

## Settings: publishing defaults (workspace-wide)
- `GET /settings/publishing` → `{ defaultPublishMode, queueSpacingMinutes, warnOnDuplicateCaptions }`
- `PUT /settings/publishing` partial body → same shape

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
