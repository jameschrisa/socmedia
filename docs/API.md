# Pulse API contract

Base URL: `http://localhost:4000/api`. JSON everywhere except uploads (multipart).
All org-scoped routes require header `X-Org-Id: <orgId>` (or `?orgId=`). Missing/unknown org → 400 `{ error }`.
Errors: `{ error: string, details?: unknown }` with 400 (validation), 404, 409, 500.
Types come from `@socmedia/shared` (`shared/src/types.ts`, zod schemas in `shared/src/schemas.ts`).

## Authentication & users
All `/api` routes except `GET /health`, `GET /auth/status`, `GET /auth/me`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/access-requests`, `GET/POST /auth/magic/*`, `GET /auth/google/*`, `GET /connections/oauth/callback` and `GET`/`POST /quick/:token` (the phone quick-post link; see "Quick post from a phone" below — its own token secret is the credential, and `/quick/tokens*` link-management routes are *not* included in this exception) require a signed-in user. `/uploads/*` stays public because the platforms pull media from those URLs in live mode. (`GET /auth/me` is listed separately below as "never 401"; it is implemented as a public route so signed-out clients can poll it without special-casing.)
Sessions: `POST /auth/login` sets an httpOnly cookie `suprstar_session` (SameSite=Lax, Secure in production, 30 days). Unauthenticated requests get 401 `{ error: "Sign in required" }`; forbidden ones 403.
Roles (`shared/src/types.ts` `ROLE_CAPABILITIES`): `owner` and `admin` manage users, organizations and workspace settings and can access every org; `editor` can create/edit/publish within their orgs; `viewer` is read-only (GET) within their orgs. Org-scoped routes check membership (`orgIds` includes the org, or `"*"`) → 403 otherwise. Mutating routes (POST/PATCH/PUT/DELETE) require `editor` or above; `/settings/*`, `/users/*`, org create/update/delete and connection create/delete/credentials require `admin`+. Owners cannot be demoted or deactivated by admins; the last active owner cannot be removed.
- `GET /auth/status` (public) → `{ needsSetup: boolean, authenticated: boolean, providers: AuthProviders, allowedDomains: string[] }`. `providers = { password: true, magicLink, google }`: `magicLink` is true when a real mailer (Resend/SMTP) is configured, or outside production where links fall back to the activity log; `google` is true when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set. `allowedDomains` lists the sign-in policy's domains (see "Access policy" below), for the sign-in page's hint text.
- `POST /auth/setup` (public, only while no users exist, else 409) body `setupSchema` → creates the first `owner` with `orgIds: "*"`, signs them in, returns `AuthState`. Env `ADMIN_EMAIL` + `ADMIN_PASSWORD` (+ optional `ADMIN_NAME`) create this owner automatically on boot when no users exist.
- `POST /auth/login` body `loginSchema` → `AuthState` (401 on bad credentials or inactive user; updates `lastLoginAt`)
- `POST /auth/logout` → 204 (clears the cookie, deletes the session)
- `GET /auth/me` → `AuthState` (`authenticated: false` when signed out; never 401) — also carries `providers`/`allowedDomains` (same shape as `/auth/status`) so the client's single persisted session query has everything the sign-in page needs.
- `POST /auth/password` body `changePasswordSchema` → 204 (clears `mustChangePassword`)
- `GET /users` (admin+) → `User[]` (never includes password hashes)
- `POST /users` (admin+) body `userCreateSchema` → `User` (201) with `mustChangePassword: true`; 409 on duplicate email; admins may not create owners.
- `PATCH /users/:id` (admin+) body `userUpdateSchema` → `User`; setting `password` marks `mustChangePassword`. Rules above apply.
- `DELETE /users/:id` (admin+) → 204 (also ends their sessions). Cannot delete yourself or the last active owner.
- Passwords are hashed with scrypt (`node:crypto`), sessions stored in a `sessions` table with an expiry and cleaned lazily.

### Magic links (email sign-in)
- `POST /auth/magic/request` (public) body `magicLinkRequestSchema` `{ email }` → 200 `MagicLinkRequestResult` `{ ok: true, delivered: "email" | "log", link? }`. `link` is only present when `delivered === "log"` outside production (developers click it instead of reading a real inbox). Requesting a link always "succeeds" for any syntactically valid email — whether the sign-in is actually allowed is decided on verify, so this endpoint never leaks which emails/domains are provisioned. Rate limited: 5 requests per email and 30 per IP per 15 minutes (in-memory) → 429 past that.
- `GET /auth/magic/verify?token=...` (public) → creates a single-use token good for 15 minutes (sha256-hashed in the `login_tokens` table; a token can only ever succeed once). On success: resolves/auto-provisions the user (see "Access policy" below), signs them in exactly like `/auth/login`, and 302s to `${CLIENT_URL}/`. On failure, 302s to `${CLIENT_URL}/?auth=error&reason=<reason>` where `reason` is `invalid` (unknown/already-used token), `expired`, `domain` (not an existing user and not an allowed domain), or `inactive` (deactivated user).
- The link itself points at `${CLIENT_URL}/api/auth/magic/verify?token=...` (not the API's own origin) because the client is served through a proxy that forwards `/api`, so the session cookie lands on the client's origin.

### Google SSO
- `GET /auth/google/start` (public) → sets a 10-minute httpOnly `suprstar_oauth_state` cookie (SameSite=Lax) and 302s to Google's OAuth consent screen (`scope=openid email profile`, `prompt=select_account`, `redirect_uri=${CLIENT_URL}/api/auth/google/callback`).
- `GET /auth/google/callback?code&state` (public) → verifies `state` against the cookie, exchanges `code` for an access token, fetches the Google profile, requires `email_verified === true`, then applies the same access-policy/provisioning logic as magic links, stores `googleSub` on the user, sets `lastLoginAt`, signs in, and 302s to `${CLIENT_URL}/`. Failure reasons (same `?auth=error&reason=` redirect as magic links): `state` (missing/mismatched state or code), `google` (token exchange, userinfo, or unverified-email failure), `domain`, `inactive`.
- Both routes return 404 `{ error: "Google sign-in is not configured" }` when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are unset.

### Access policy (self-serve sign-in allowlist)
Stored in `app_settings` under key `access_policy`; default is `{ domains: [{ domain: "enelhealth.com", role: "editor", orgSlugs: ["enel-health"] }, { domain: "f3insights.com", role: "editor", orgSlugs: ["f3i"] }], allowInvitedUsersAnyDomain: true }`. Magic link and Google sign-in are allowed when (a) an active user with that email already exists and either `allowInvitedUsersAnyDomain` is true or their domain is itself allowed, or (b) the email's domain is in `domains`, in which case a user is auto-provisioned with that domain's `role` and `orgIds` (resolved from `orgSlugs`; `"*"` stays `"*"`), `mustChangePassword: false`, and a random unusable password. Deactivated users are always refused (`reason=inactive`).
- `GET /settings/access-policy` (admin+) → `AccessPolicy`
- `PUT /settings/access-policy` (admin+) body `accessPolicySchema` → `AccessPolicy`. Every `orgSlugs` entry must reference an existing organization or be `"*"` (400 otherwise); `role` can never be `owner` (rejected by the schema itself).

### Access requests
For anyone outside the allowed domains: `POST /auth/access-requests` (public) body `accessRequestCreateSchema` `{ name, email, organization?, message? }` → 201 `AccessRequest` (`status: "pending"`). 409 when an account with that email already exists, or another request for it is still pending. Rate limited: 5 per IP per hour. When a mailer is configured, every active `owner`/`admin` is emailed a short notice.
- `GET /users/access-requests` (admin+) `?status=pending|approved|declined` → `AccessRequest[]`, newest first.
- `POST /users/access-requests/:id/approve` (admin+) body `accessRequestApproveSchema` `{ role, orgIds }` → `{ request: AccessRequest, user: User, temporaryPassword?: string, magicLinkSent: boolean }`. Creates the user with `mustChangePassword: true`; when a mailer is configured, a magic link is emailed instead and `temporaryPassword` is omitted (`magicLinkSent: true`). 409 if the request isn't `pending`, or a user with that email already exists.
- `POST /users/access-requests/:id/decline` (admin+) → `AccessRequest` (`status: "declined"`). 409 if the request isn't `pending`.

### Mailer (`server/src/services/mailer.ts`)
`sendMail({ to, subject, text, html? })` picks a provider by env `MAIL_PROVIDER`: `resend` (HTTPS to `api.resend.com/emails` with `RESEND_API_KEY` + `MAIL_FROM`), `smtp` (via `nodemailer`, `SMTP_URL` + `MAIL_FROM`), or `log` (default: writes the message, including any magic link, to the activity log at `info` level with source `auth` — this is what developers see in place of a real inbox). If the selected provider isn't fully configured, or the send itself throws, it falls back to the log so sign-in never hard-fails because mail is down. `mailerStatus()` reports `{ provider, configured }`.

## Health
- `GET /health` → `{ ok: true, version, time, ai: { configured: boolean, model } }`

## Organizations (not org-scoped)
Every mutating method under `/orgs` (POST/PATCH/DELETE, including the demo-seeding endpoints) requires `admin`+, same as org create/update/delete/logo; `GET` endpoints only require a signed-in user.
- `GET /orgs` → `Organization[]` (owners and admins see every organization; other users only the organizations in their `orgIds`, and `GET /orgs/:id` returns 404 for the rest)
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
Sign-in: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google SSO; both required, redirect URI `${CLIENT_URL}/api/auth/google/callback`), `MAIL_PROVIDER=resend|smtp|log` (default `log`), `MAIL_FROM` (resend/smtp), `RESEND_API_KEY` (resend), `SMTP_URL` (smtp, e.g. `smtps://user:pass@smtp.example.com`).

## Settings (workspace-wide, not org-scoped)
- `GET /settings/ai` → `AiSettings` (API keys masked). `provider` is the chosen provider; `anthropicFromEnv` is true when the Anthropic key comes from `ANTHROPIC_API_KEY`.
- `PUT /settings/ai` body `aiSettingsUpdateSchema` → `AiSettings`. Masked key values are ignored; `""` clears a key. Keys are encrypted at rest.
- `POST /settings/ai/test` `{ provider: "anthropic" | "moonshot" }` → `AiProviderTestResult` (checks credentials + model availability).
- `GET /settings/ai/models?provider=` → `{ provider, models: string[] }`.
- `GET /health` now reports `ai: { configured, provider, model }` from the active settings. When the chosen provider has no key the AI endpoints fall back to the offline mock.
- Moonshot (Kimi) is called through its OpenAI-compatible endpoint (`https://api.moonshot.ai/v1/chat/completions`, JSON mode) and validated against the same zod schemas as Anthropic's structured outputs.

## Activity log ("console")
Every request, auth event, scheduler tick that published something, publish job, media mutation, org/settings change and agent/quick-post action is recorded to a singleton logger (`server/src/services/logger.ts`): an in-memory ring buffer of the last 2000 entries (used for these endpoints and the SSE stream), newline-delimited JSON files at `<dataDir>/logs/app-YYYY-MM-DD.log` (one per calendar day, pruned after 14 days at server startup), and stdout as JSON (so platforms that only capture stdout, e.g. Render, still see everything). Secrets are redacted: any data field whose name contains `password`, `token`, `secret` or `apiKey` (case-insensitive) becomes `"[redacted]"`, recursively.

A `LogEntry` is `{ id, at, level: "debug"|"info"|"warn"|"error", source: "http"|"auth"|"scheduler"|"publisher"|"media"|"agent"|"quick"|"system", message, orgId: string|null, userId: string|null, data: Record<string, unknown>|null }`.

Visibility: `owner`/`admin` see every entry. `editor`/`viewer` never see `auth` or `system`-source entries, and only see entries where `orgId` is `null` or one of their orgs.

- `GET /api/logs?limit&level&source&since&q` (signed-in) → `{ entries: LogEntry[] }`. `limit` (default 200, max 2000) newest-last (chronological); `level`/`source` exact match; `since` is an ISO datetime; `q` is a case-insensitive substring match on `message`.
- `GET /api/logs/stream` (signed-in) → Server-Sent Events, `Content-Type: text/event-stream`. Each new entry (post-visibility-filter, honouring `?level&source` query filters) is sent as `event: log\ndata: <LogEntry JSON>\n\n`; a `: ping\n\n` comment is sent every 20s to keep the connection alive through proxies. Uses the same cookie session as everything else (EventSource sends cookies automatically with `withCredentials`/same-origin); no special client handling needed beyond that. The stream itself is excluded from HTTP request logging.
- `GET /api/logs/files` (admin+) → `{ files: LogFileInfo[] }`, `LogFileInfo = { name, size, modifiedAt }`, newest first.
- `GET /api/logs/files/:name?tail=500` (admin+; `name` must match `^app-\d{4}-\d{2}-\d{2}\.log$`, else 400; unknown file → 404) → `{ name, size, lines: string[] }`, the last `tail` (default 500, max 10000) lines of that file.

## Agent console
`POST /api/agent/commands` (org-scoped via `X-Org-Id`, signed-in, any role) body `{ input }` (`agentCommandSchema`, 1–4000 chars) → `AgentCommandResult` = `{ id, input, reply, actions: AgentAction[], model, mock, at }`. `AgentAction = { tool, input, ok, summary }`. `reply` is plain text (may contain newlines / simple space-padded tables), capped at 1500 characters for AI replies. Every command is logged (source `agent`, listing the tools used); every tool-driven mutation is logged again individually.

Two paths, chosen by whether `input` (trimmed) starts with `/`:

**a) Built-in slash commands** — exact, fast, no AI call (`model: "slash-command"`, `mock: false`):
- `/help` — lists commands
- `/status` — scheduler interval + post counts by status + enabled/total accounts
- `/posts [status]` — list posts, optionally filtered
- `/jobs [status]` — list publish jobs, optionally filtered (e.g. `failed`, `queued`)
- `/accounts` — list connected accounts
- `/media` — list media assets
- `/publish <postId>` — publish a post now (**write role**: editor+)
- `/retry <jobId>` — retry a failed/stuck job (**write role**: editor+)
- `/logs [level] [n]` — recent log lines (respects the caller's log visibility rules)
- `/whoami` — the caller's name/email/role/orgs

Viewers get a clear refusal (`ok: false` action, reply explains the role requirement) instead of a 403 when they try a write slash command, so read-only commands in the same session keep working.

**b) Anything else** goes to a tool-using AI agent, using whichever provider is active in `aiSettings` (see Settings above):
- **Anthropic**: a manual `messages.create` tool-use loop (up to 8 iterations) — the model can call any tool below; results are fed back as `tool_result` blocks until it replies with plain text (`end_turn`).
- **Moonshot**: the same tool set via its OpenAI-compatible function-calling API (`tool_calls` / `role: "tool"` messages), same 8-iteration cap.
- **No provider configured**: a deterministic offline mock (`mock: true`, `model: "offline-mock"`) pattern-matches a handful of intents — "list posts", "what failed", "publish `<postId>`", "schedule `<postId>` for `<when>`" — and otherwise explains that an AI provider needs to be configured in Settings → AI.

Tools (all scoped to the caller's org and role; write tools refuse for viewers with a clear message instead of mutating): `list_posts({status?, limit?})`, `get_post({id})`, `create_post({title, caption, hashtags?, platforms?, connectionIds?, scheduledAt?, mediaIds?})` (targets default to every enabled account for the given platforms — or every enabled account if neither is given — format = each platform's first supported format), `update_post({id, ...})`, `schedule_post({id, scheduledAt})`, `publish_post({id})`, `delete_post({id})`, `list_media({kind?, tag?})`, `list_accounts()`, `list_jobs({status?})`, `retry_job({id})`, `analytics_summary({range?: "7d"|"30d"})`, `generate_captions({brief, platforms})`, `recent_logs({level?, limit?})`, `search_posts({q})`.

The system prompt names the organization, today's date and its timezone, and instructs the model to use tools rather than invent ids, and to confirm exactly what changed (with ids).

## Quick post from a phone
A long-lived link ties an org, a user and a set of target accounts to a secret token; opening it on a phone shows a tiny page to snap a photo (and optionally record a voice memo) and post it — no login required on the phone.

**Link management** (signed-in, org-scoped via `X-Org-Id`, write role: editor+):
- `GET /api/quick/tokens` → `QuickPostToken[]` for the org (no `token` field — the secret is never returned again after creation).
- `POST /api/quick/tokens` body `quickPostTokenCreateSchema` `{ label, connectionIds?, publishMode? }` → `QuickPostToken` (201) **including `token`** (the 32+ char url-safe secret) — shown once; only its sha256 hash is stored, alongside a 4-character `tokenPreview` for display.
- `PATCH /api/quick/tokens/:id` body `quickPostTokenUpdateSchema` (partial, plus `active`) → `QuickPostToken`.
- `DELETE /api/quick/tokens/:id` → 204.

**Public endpoints** (no session — the token secret in the URL is the credential; excluded from the auth gate; rate-limited to 30 submissions per token per hour, 429 beyond that):
- `GET /api/quick/:token` → `QuickPostPublicInfo` = `{ label, orgName, orgLogoUrl, brandColor, targets: { connectionId, platform, label, handle }[], aiAvailable }`. 404 for an unknown or deactivated token; never reveals the org id.
- `POST /api/quick/:token` multipart/form-data:
  - `image` (required, `image/*`, ≤ 15MB) — saved via the normal media pipeline, tagged `["quick"]`.
  - `memo` (optional, `audio/*`, ≤ 20MB) — saved under `data/uploads/<orgId>/memos/<file>` and referenced by URL in the post's `notes`. **It is not transcribed server-side** — the phone page is expected to supply an on-device speech-to-text `transcript` field alongside it.
  - Text fields (`quickPostFieldsSchema`): `caption?`, `transcript?`, `polish` (default `true`).

  Caption resolution, in order:
  1. `caption` non-empty → used as-is, `captionSource: "caption"`.
  2. else `transcript` non-empty → if `polish` is true **and** an AI provider is configured, the transcript is turned into a one-paragraph caption plus up to 8 hashtags via `aiProviders.structured()` (`captionSource: "ai"`); otherwise (including the offline mock) the trimmed transcript is used as-is (`captionSource: "transcript"`).
  3. else → the post is created as a `draft` with `notes: "Needs a caption (submitted from phone)"` (plus the memo URL, if any) and the response is **202** with `status: "needs_caption"` and empty `links`.

  Otherwise (a caption was resolved): a post is created (`title` = first 60 chars of the caption, `mediaIds: [image.id]`, `targets` = the token's `connectionIds` or every enabled account of the org with each platform's first supported format, `publishMode` from the token) and published immediately via the normal publish path, and the response is **201** `QuickPostResult` = `{ post, media, status, caption, captionSource, links: QuickPostLink[] }` where each `QuickPostLink` = `{ connectionId, platform, label, status, url, error }` mirrors that target's publish job (sandbox mode returns simulated URLs, same as the rest of the app). The token's `usesCount`/`lastUsedAt` are bumped on every successful submission (including `needs_caption`), and the confirmation (with links) is logged under source `quick` so it shows up in the activity console too.

  iOS Shortcuts example:
  ```sh
  curl -F image=@photo.jpg -F caption="Fresh from the studio" https://host/api/quick/<token>
  ```
