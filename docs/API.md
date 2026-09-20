# Pulse API contract

Base URL: `http://localhost:4000/api`. JSON everywhere except uploads (multipart).
All org-scoped routes require header `X-Org-Id: <orgId>` (or `?orgId=`). Missing/unknown org → 400 `{ error }`.
Errors: `{ error: string, details?: unknown }` with 400 (validation), 404, 409, 500.
Types come from `@socmedia/shared` (`shared/src/types.ts`, zod schemas in `shared/src/schemas.ts`).

## Authentication & users
All `/api` routes except `GET /health`, `GET /auth/status`, `GET /auth/me`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/access-requests`, `GET/POST /auth/magic/*`, `GET /auth/google/*`, `GET /auth/entra/*`, `GET /connections/oauth/callback` and `GET`/`POST /quick/:token` (the phone quick-post link; see "Quick post from a phone" below — its own token secret is the credential, and `/quick/tokens*` link-management routes are *not* included in this exception) require a signed-in user. `/uploads/*` stays public because the platforms pull media from those URLs in live mode. (`GET /auth/me` is listed separately below as "never 401"; it is implemented as a public route so signed-out clients can poll it without special-casing.)
Sessions: `POST /auth/login` sets an httpOnly cookie `suprstar_session` (SameSite=Lax, Secure in production, 30 days). Unauthenticated requests get 401 `{ error: "Sign in required" }`; forbidden ones 403.
Roles (`shared/src/types.ts` `ROLE_CAPABILITIES`): `owner` and `admin` manage users, organizations and workspace settings and can access every org; `editor` can create/edit/publish within their orgs; `viewer` is read-only (GET) within their orgs. Org-scoped routes check membership (`orgIds` includes the org, or `"*"`) → 403 otherwise. Mutating routes (POST/PATCH/PUT/DELETE) require `editor` or above; `/settings/*`, `/users/*`, org create/update/delete and connection create/delete/credentials require `admin`+. Owners cannot be demoted or deactivated by admins; the last active owner cannot be removed.
- `GET /auth/status` (public) → `{ needsSetup: boolean, authenticated: boolean, providers: AuthProviders, allowedDomains: string[] }`. `providers = { password: true, magicLink, google, entra }`: `magicLink` is true when a real mailer (Resend/SMTP) is configured, or outside production where links fall back to the activity log; `google` is true when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set; `entra` is true when `ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET` are set. `allowedDomains` lists the sign-in policy's domains (see "Access policy" below), for the sign-in page's hint text.
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

### Microsoft Entra ID SSO
- `GET /auth/entra/start` (public) → sets a 10-minute httpOnly `suprstar_entra_state` cookie (SameSite=Lax; the value is `<random>.<nonce>`, so the callback recovers the nonce from the same cookie it checks for CSRF without a second cookie) and 302s to the tenant's authorize endpoint `https://login.microsoftonline.com/{ENTRA_TENANT_ID}/oauth2/v2.0/authorize` (`response_type=code`, `response_mode=query`, `scope=openid profile email`, `redirect_uri=${CLIENT_URL}/api/auth/entra/callback`, plus `state` and `nonce`).
- `GET /auth/entra/callback?code&state` (public) → verifies `state` against the cookie, exchanges `code` at `https://login.microsoftonline.com/{ENTRA_TENANT_ID}/oauth2/v2.0/token`, then **verifies the returned `id_token`'s RS256 signature** against the tenant's JWKS (`https://login.microsoftonline.com/{ENTRA_TENANT_ID}/discovery/v2.0/keys`, cached in memory for an hour per tenant) before trusting any claim. Checked claims: `aud` (our client id), `iss` (starts with `https://login.microsoftonline.com/`), `tid` (must equal `ENTRA_TENANT_ID` when it's a specific tenant, not `organizations`), `exp` (with a small clock-skew allowance), and `nonce` (must match the one issued at `/start`). Identity: email is `email` ?? `preferred_username` ?? `upn` (lowercased; rejected if missing or without `@`), subject is `oid` ?? `sub`. Applies the same access-policy/provisioning logic as magic links and Google, stores `entraSub` on the user, sets `lastLoginAt`, signs in, and 302s to `${CLIENT_URL}/`. Failure reasons (same `?auth=error&reason=` redirect as Google/magic links): `state` (missing/mismatched state or code), `entra` (token exchange, JWKS fetch, or any id_token validation failure — bad signature, wrong `aud`/`tid`, expired, mismatched `nonce`, or an unusable email claim), `domain`, `inactive`.
- Both routes return 404 `{ error: "Microsoft sign-in is not configured" }` when `ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET` are unset. Register `${CLIENT_URL}/api/auth/entra/callback` as the app's redirect URI in the Entra portal.

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

### Mail self-test (`GET`/`POST /settings/mail*`, admin+)
Makes it visible from Settings whether magic links can actually be delivered, since a hosted deployment with no mail provider would otherwise fail silently.
- `GET /settings/mail` (admin+) → `MailStatus` = `mailerStatus()` (`provider`, `configured`) plus `from` (`MAIL_FROM` or `null`), `canSendMagicLinks` (`magicLinkAvailable()`), and the last self-test result (`lastTestAt`, `lastTestOk`, `lastTestError`; all `null` until a test has been sent). The last-test state is in-memory (resets on restart).
- `POST /settings/mail/test` (admin+) body `mailTestSchema` `{ to }` → 200 `MailStatus` with the just-recorded result. Sends "suprstar mail test" through whichever provider is actually configured (bypassing `sendMail`'s silent log fallback, so a real provider failure is visible here). A failed send is recorded as `lastTestOk: false` with `lastTestError` set — **the endpoint still answers 200** (never throws), since the point is to report the failure, not to 500. When no provider is configured, the message goes to the activity log only and the response says so plainly in `lastTestError` rather than pretending it was delivered (`lastTestOk` is still `true`, since the log fallback itself didn't fail). Every attempt (success, failure, or log-only) is logged to source `auth`. Rate limited to 5 per signed-in user per hour → 429 `{ error }` past that.

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
- Five platforms are supported: `tiktok`, `youtube`, `linkedin`, `instagram`, `x`. `ensureConnectionsForOrg` creates one disconnected sandbox connection per entry in `PLATFORMS` for every org, so this list drives connection counts everywhere (tests assert `PLATFORMS.length`, not a literal `4`).
- PKCE (X): a `PlatformAdapter` may implement an optional `prepareAuthorization(conn)` hook returning `{ extra }` to merge into `credentials.extra` and persist *before* `buildAuthorizeUrl` runs. X's adapter uses this to generate an RFC 7636 `code_verifier`, store it as `credentials.extra.codeVerifier`, and derive the S256 `code_challenge`/`code_challenge_method` query params on the authorize URL; `exchangeCode` sends `code_verifier` back plus HTTP Basic auth (`clientId:clientSecret`) to `POST https://api.x.com/2/oauth2/token`, and clears the verifier from `extra` once the exchange succeeds.

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
Sign-in: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google SSO; both required, redirect URI `${CLIENT_URL}/api/auth/google/callback`), `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` (Microsoft Entra ID SSO; both required, redirect URI `${CLIENT_URL}/api/auth/entra/callback`) / `ENTRA_TENANT_ID` (default `organizations`; set to a specific tenant GUID or verified domain, e.g. `f3insights.com`, to restrict sign-in to that tenant and enforce the `tid` claim check), `MAIL_PROVIDER=resend|smtp|log` (default `log`), `MAIL_FROM` (resend/smtp), `RESEND_API_KEY` (resend), `SMTP_URL` (smtp, e.g. `smtps://user:pass@smtp.example.com`).
Console: `OS_TERMINAL=on|off` — enables/disables the in-app OS terminal (see "OS terminal" below); defaults to `on` when `NODE_ENV !== "production"` and `off` in production, so a Render deploy needs `OS_TERMINAL=on` set explicitly to expose it.

## Settings (workspace-wide, not org-scoped)
- `GET /settings/ai` → `AiSettings` (API keys masked). `provider` is the chosen provider; `anthropicFromEnv` is true when the Anthropic key comes from `ANTHROPIC_API_KEY`.
- `PUT /settings/ai` body `aiSettingsUpdateSchema` → `AiSettings`. Masked key values are ignored; `""` clears a key. Keys are encrypted at rest.
- `POST /settings/ai/test` `{ provider: "anthropic" | "moonshot" }` → `AiProviderTestResult` (checks credentials + model availability).
- `GET /settings/ai/models?provider=` → `{ provider, models: string[] }`.
- `GET /health` now reports `ai: { configured, provider, model }` from the active settings. When the chosen provider has no key the AI endpoints fall back to the offline mock.
- Moonshot (Kimi) is called through its OpenAI-compatible endpoint (`https://api.moonshot.ai/v1/chat/completions`, JSON mode) and validated against the same zod schemas as Anthropic's structured outputs.
- `GET /settings/mail` and `POST /settings/mail/test` — see "Mail self-test" above.

## Activity log ("console")
Every request, auth event, scheduler tick that published something, publish job, media mutation, org/settings change and agent/quick-post action is recorded to a singleton logger (`server/src/services/logger.ts`): an in-memory ring buffer of the last 2000 entries (used for these endpoints and the SSE stream), newline-delimited JSON files at `<dataDir>/logs/app-YYYY-MM-DD.log` (one per calendar day, pruned after 14 days at server startup), and stdout as JSON (so platforms that only capture stdout, e.g. Render, still see everything). Secrets are redacted: any data field whose name contains `password`, `token`, `secret` or `apiKey` (case-insensitive) becomes `"[redacted]"`, recursively.

A `LogEntry` is `{ id, at, level: "debug"|"info"|"warn"|"error", source: "http"|"auth"|"scheduler"|"publisher"|"media"|"agent"|"quick"|"inbound"|"system", message, orgId: string|null, userId: string|null, data: Record<string, unknown>|null }`.

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
- `/docs <platform?> <query>` — search the bundled platform developer-docs knowledge base (`docs/platforms`); prints the top hits as `[platform] file — heading (source url)`
- `/diagnose <connectionId|platform>` — bundle a connection's status/mode/scopes/token expiry, last test result, 5 most recent jobs and the top doc hits for its most recent error; a platform name resolves to the org's first account on that platform
- `/whoami` — the caller's name/email/role/orgs

Viewers get a clear refusal (`ok: false` action, reply explains the role requirement) instead of a 403 when they try a write slash command, so read-only commands in the same session keep working.

**b) Anything else** goes to a tool-using AI agent, using whichever provider is active in `aiSettings` (see Settings above):
- **Anthropic**: a manual `messages.create` tool-use loop (up to 8 iterations) — the model can call any tool below; results are fed back as `tool_result` blocks until it replies with plain text (`end_turn`).
- **Moonshot**: the same tool set via its OpenAI-compatible function-calling API (`tool_calls` / `role: "tool"` messages), same 8-iteration cap.
- **No provider configured**: a deterministic offline mock (`mock: true`, `model: "offline-mock"`) pattern-matches a handful of intents — "list posts", "what failed", "publish `<postId>`", "schedule `<postId>` for `<when>`" — and otherwise explains that an AI provider needs to be configured in Settings → AI. Messages containing "why did", "failed", "error", "diagnose" or "not connecting" together with a platform name (tiktok/youtube/linkedin/instagram) are routed to `diagnose_connection` for that platform's first account and quote the top doc hit (file, heading, excerpt, source URL) when one is found.

Tools (all scoped to the caller's org and role; write tools refuse for viewers with a clear message instead of mutating): `list_posts({status?, limit?})`, `get_post({id})`, `create_post({title, caption, hashtags?, platforms?, connectionIds?, scheduledAt?, mediaIds?})` (targets default to every enabled account for the given platforms — or every enabled account if neither is given — format = each platform's first supported format), `update_post({id, ...})`, `schedule_post({id, scheduledAt})`, `publish_post({id})`, `delete_post({id})`, `list_media({kind?, tag?})`, `list_accounts()`, `list_jobs({status?})`, `retry_job({id})`, `analytics_summary({range?: "7d"|"30d"})`, `generate_captions({brief, platforms})`, `recent_logs({level?, limit?})`, `search_posts({q})`, `platform_docs({platform?, query, limit?})` (searches `docs/platforms`; boosts matches for `platform` and for query terms found in the section heading), `diagnose_connection({connectionId})` (bundles connection status/mode/scopes/token expiry, masked access token, last test result, 5 most recent jobs for that connection, and the top 3 `platform_docs` hits for the most recent error text).

The system prompt names the organization, today's date and its timezone, instructs the model to use tools rather than invent ids and to confirm exactly what changed (with ids), and tells it to inspect the relevant connection (`list_accounts`, `diagnose_connection`, `recent_logs`, `list_jobs`) and then consult `platform_docs` for the exact error string before answering a connection/account/publishing problem, citing the doc file and source URL in the reply.

## OS terminal
A real (or best-effort) login shell to the host, streamed over a WebSocket for owners/admins in the Console drawer.

- `GET /api/terminal/status` (signed-in, any role) → `TerminalStatus` = `{ enabled, reason, platform, shell, hostname, user, cwd, pty }`. `enabled` is `false` with a human-readable `reason` for editors/viewers ("Only owners and admins can use the OS terminal.") and whenever the `OS_TERMINAL` feature flag is off. `shell` is `$SHELL` or a platform default (`/bin/zsh` darwin, `/bin/bash` linux, `powershell.exe` win32); `cwd` is the parent of `DATA_DIR`; `pty` is true when the optional `node-pty` native module loaded (a real pseudo-terminal is used) and false when the plain-pipe fallback will be used instead (line editing, resize and job control are limited in that fallback).
- WebSocket `ws(s)://<host>/api/terminal?cols=&rows=` (same-origin, cookie auth): the server (`server/src/index.ts`) creates its `http.Server` explicitly and attaches a `WebSocketServer({ noServer: true })` to its `upgrade` event for this path only, authenticating from the `suprstar_session` cookie with the same session lookup the HTTP middleware uses. A signed-out caller or a role below admin gets the handshake rejected outright (401/403 written to the raw socket, no WebSocket frames) — no separate error message. On success the server immediately sends `{ type: "ready", status: TerminalStatus, cols, rows }`, then streams `{ type: "output", data }` as the shell produces output. The client sends `{ type: "input", data }` (raw bytes/keystrokes) and `{ type: "resize", cols, rows }`; a `{ type: "ping" }` gets a `{ type: "pong" }` back. When the shell process exits the server sends `{ type: "exit", code }` and closes the socket. Closing the socket (from either side) kills the shell.
- Concurrency: at most 3 sessions per user and 10 total; exceeding either sends `{ type: "error", message }` and closes instead of spawning. An idle session (no input/output for 30 minutes) is killed automatically.
- Never logged: the command stream itself. Only session start/end are logged (source `system`, with the user id and hostname, never the terminal content).
- Env: `OS_TERMINAL=on|off` (default `on` outside production, `off` in production — Render needs it set explicitly; the shell there is the container's own bash). Node's optional native `node-pty` dependency gives a real pty; when it isn't installed (e.g. no compiler on a slim container image) or fails to actually fork one, the server transparently falls back to `child_process.spawn` with piped stdio and posts a one-line notice into the stream.
- Client integration: the Vite dev proxy for `/api` needs `ws: true` so the upgrade passes through in development; nothing else is required server-side beyond this endpoint.

## Platform developer-docs search
An offline knowledge base under `docs/platforms/<platform>/{overview,oauth,publishing,errors,troubleshooting}.md` (front matter `platform`, `topic`, `sources`, `fetched`; body split into sections on `##`/`###` headings) that the agent's `platform_docs`/`diagnose_connection` tools and the two endpoints below search. Indexed lazily on first use with a BM25-ish tf-idf keyword search (tokens ≥3 chars plus short codes like `429`), boosted when the section's platform matches the query's `platform` and when a query term appears in the section heading; excerpts are trimmed to ~900 characters around the best-matching line. Tolerates an empty or missing folder (empty results, no error).
- `GET /api/docs/platforms/search?platform=&q=&limit=` (signed-in, any role, not org-scoped) → `{ hits: PlatformDocHit[] }`. `PlatformDocHit = { platform, file, topic, heading, excerpt, score, sources }`; `file` is repo-relative (e.g. `docs/platforms/youtube/oauth.md`). Empty/missing `q` → `{ hits: [] }`. `limit` default 5, max 20.
- `GET /api/docs/platforms/status` (signed-in) → `{ files, sections, platforms: string[] }` — for the client's Documentation panel.

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

## Inbound messaging (post by texting a chat bot)
People can post to suprstar without opening the app: text a photo (with a caption, or a voice note) to a linked Twilio/WhatsApp number or Telegram bot, and it publishes through the same pipeline as Quick Post. A "test" channel drives the setup wizard and the test suite without any real provider.

### Storage
- `app_settings` key `inbound_channel:<channel>` (`twilio` | `telegram` | `test`) — JSON `{ enabled, settings: Record<string,string>, webhookRegistered, extra: Record<string,string> }`. Secret fields (Twilio's `authToken`, Telegram's `botToken`, Telegram's `extra.secretToken`) are `encrypt()`'d at rest with the same AES-256-GCM helper as everything else in `app_settings`; everything else (`accountSid`, `fromNumber`, `extra.botUsername`) is stored plain. Masked in API responses with `mask()` (`••••` + last 4); re-saving with a masked value leaves the stored secret untouched, `""` clears it. See `server/src/services/inboundSettings.ts`.
- `app_settings` key `transcription` — JSON `{ provider: "none"|"openai"|"deepgram", apiKey }`, `apiKey` encrypted at rest, masked in responses. See `server/src/services/transcriptionSettings.ts`.
- Table `inbound_bindings` — ties one `(channel, senderId)` to a suprstar `userId` + `orgId` + target `connectionIds`/`publishMode`/`confirmBeforePosting`, with `status: "pending"|"verified"|"revoked"` and a 6-digit `verificationCode` (returned only once, at creation). Repository: `server/src/db/repositories/inboundBindings.ts`.
- Table `inbound_messages` — one row per inbound provider message, unique on `(channel, providerMessageId)` for idempotency. Carries `text`, `mediaCount`, `hasAudio`, `status`, `postId`, `mediaIds` (JSON), `links` (JSON `QuickPostLink[]`), `reply`/`repliedBy`, `error`, and a `timeline` (JSON `InboundTimelineEntry[]`, one entry per status transition plus `reply_sent`/`reply_failed`). Repository: `server/src/db/repositories/inboundMessages.ts`. Both tables are created by `runIncrementalMigrations()` in `server/src/db/database.ts`.

### Channel adapters
`server/src/inbound/{twilio,telegram,test}.ts` implement a common `InboundAdapter` interface (`server/src/inbound/types.ts`): `verify(req, settings)`, `parse(req, settings) → Promise<NormalizedInbound|null>`, `reply(settings, senderId, text)`, `webhookPath`, `describe(settings)`. `NormalizedInbound = { providerMessageId, senderId, senderLabel?, text, media: { url, mimeType?, headers? }[], audio? }`. The registry is `server/src/inbound/index.ts` (`getAdapter(channel)`).

- **twilio** — settings `accountSid`, `authToken`, `fromNumber` (E.164, or `whatsapp:+1...` for WhatsApp). `verify` recomputes the HMAC-SHA1-then-base64 signature over the full webhook URL (`${PUBLIC_BASE_URL||CLIENT_URL}/api/inbound/twilio`) plus the sorted POST params, keyed by `authToken`, and compares it to `X-Twilio-Signature` with `timingSafeEqual`. `parse` reads form fields `From`, `Body`, `MessageSid`, `NumMedia`, `MediaUrl0..N`/`MediaContentType0..N` (an `audio/*` content type becomes `audio` instead of `media`); WhatsApp senders keep their `whatsapp:+E164` prefix as `senderId` so replies route back correctly. Each media item carries an `Authorization: Basic <accountSid:authToken>` header for the pipeline's download step. `reply` posts `From`/`To`/`Body` to `https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json`. The webhook route responds with an empty `<Response/>` (`text/xml`, 200) immediately and processes the message asynchronously afterwards, so Twilio never sees the pipeline's latency.
- **telegram** — settings `botToken`, derived `extra.botUsername` (from `getMe`) and `extra.secretToken` (generated on save, sent to `setWebhook`, and required back on every request as `X-Telegram-Bot-Api-Secret-Token` — Telegram doesn't sign webhook bodies, so this header is the only authentication). Webhook URL is `${base}/api/inbound/telegram/<secretToken>`. `parse` reads `message.chat.id` as `senderId`, `text` or `caption`, the largest `photo` size (resolved to a download URL via `getFile`), and `voice`/`audio` as the audio item. `reply` calls `sendMessage`. `POST /api/inbound/channels/telegram/register` (re)calls `getMe` + `setWebhook` and reports `webhookRegistered`; `PUT /api/inbound/channels/telegram` does the same automatically whenever a bot token is saved.
- **test** — not a real provider. `POST /api/inbound/test` (admin+, signed-in — never public) builds the `NormalizedInbound` directly from `inboundTestMessageSchema` (`imageUrl` is a data URL, decoded locally, or an absolute URL, fetched) and runs it through the exact same `processInbound()` pipeline synchronously, returning the resulting `InboundMessage` (including its `reply`) so the setup wizard can show "what the bot would have said" without a real phone number or bot token. Its `reply()` is a no-op; the reply text is already on the returned message.

### Pipeline (`processInbound(db, channel, normalized)` in `server/src/services/inbound.ts`)
1. **Idempotency**: `(channel, providerMessageId)` already seen → returns the existing `InboundMessage` unchanged (no reprocessing, no duplicate reply).
2. Creates the `inbound_messages` row (`status: "received"`) and logs `inbound` info `Message received from <channel> ••••<last 4 of senderId>` (WhatsApp's `whatsapp:` prefix is stripped before masking).
3. **No verified binding for `(channel, senderId)`**:
   - Text is a 6-digit code matching a `pending` binding for that exact `(channel, senderId)`, or (falling back) any `pending` binding on that channel with a matching code — verifies it (and rewrites its `senderId` to the actual sender, for the fallback case), replies **`Linked to <org name>. Send a photo with a caption to post.`**, status `command`.
   - Otherwise replies **`This number isn't linked to suprstar. Ask an owner for a link code.`**, status `unknown_sender`, logged at `warn`.
4. **With a verified binding**, in order:
   - Text starts with `/` → runs `executeAgentCommand()` (extracted from `routes/agent.ts`, shared with `POST /api/agent/commands`) as the binding's user in the binding's org; replies with the agent's reply, `repliedBy: "agent"`, status `command`.
   - Text is `yes`/`y`/`post` and there's an `awaiting_confirmation` message from this sender within the last 30 minutes → publishes it (via `publishQuickPostFromMedia()`, reusing the image already saved at the confirmation step) and updates *both* that original message and this new one to the outcome. No match (expired or none pending) → status `ignored`, no reply.
   - Text is `no` → status `ignored`, no reply.
   - No media and no audio at all → replies **`Send a photo with a caption to post.`**, status `ignored`.
   - An image is present: rejected (with a reply, status `failed`) when it's over 15MB (**`That image is too large (max 15MB). Try a smaller photo.`**) or not an `image/*` mime type (**`Only photos can be posted from chat right now.`**); download failures reply **`Couldn't download that photo; please try sending it again.`**.
   - Caption = the message text; if there's no text but there is an audio item, it's downloaded and transcribed with the configured provider (see below) and the transcript becomes the caption.
   - Still no caption → creates a real draft post + media through the shared quick-post helper (`createAndPublishQuickPost()`, same one `routes/quick.ts` uses) and replies **`Saved as a draft: add a caption in suprstar.`**, status `draft`.
   - `confirmBeforePosting` on the binding → saves the image now (`saveQuickPostImage()`), replies with the caption, the resolved target account names and **`Reply YES to post or NO to discard.`** (exact template: `` `${caption}\n\nPosting to: ${targetNames}.\nReply YES to post or NO to discard.` ``), status `awaiting_confirmation`. Expires after 30 minutes (a late `yes` is treated as "none pending").
   - Otherwise publishes immediately through `createAndPublishQuickPost()` with `source: "inbound"` and replies **`Posted to <n> account(s):`** followed by one `<label or platform> <url>` line per link (or `(error)` in place of a missing URL); if every target failed, replies **`Couldn't post to any accounts:`** plus one `<label>: <error>` line per target instead, status `failed`. A thrown publish error replies **`Couldn't post that: <error>`**, status `failed`.
5. Every transition appends an `InboundTimelineEntry` (`{ at, status, message }`, plus synthetic `reply_sent`/`reply_failed` entries around the actual provider call) and is logged (`log.info`/`log.warn`, source `inbound`, with `orgId`/`userId` and `data: { inboundMessageId, status }`), and pushes `{ type: "message", message }` to every `GET /api/inbound/stream` subscriber. Channel-config or transcription-setting changes push `{ type: "status", status: InboundStatus }`.
6. **Media fetch** (`downloadMedia`, shared by all channels): `data:` URLs are decoded locally (used by the test channel); everything else is fetched with `fetch` plus whatever `headers` the adapter attached (Twilio's HTTP Basic auth). **Transcription** (`transcribeAudio`, only called when transcription is configured): `openai` → `POST https://api.openai.com/v1/audio/transcriptions` (`multipart/form-data`, `model=whisper-1`, `Authorization: Bearer <key>`); `deepgram` → `POST https://api.deepgram.com/v1/listen` (raw audio body, `Authorization: Token <key>`). Any transcription failure is swallowed (logged at `warn`) and treated as "no caption".

### Routes (`server/src/routes/inbound.ts`, mounted at `/api/inbound`, not org-scoped by middleware — routes that need an org read the `X-Org-Id` header themselves)
Public (added to `authGate`'s allow-list in `middleware/auth.ts`; both return fast and never reveal whether a sender is known — the actual outcome only ever reaches the sender via the channel's own reply):
- `POST /api/inbound/twilio` — form-encoded (parsed with its own `express.urlencoded()`, since the app-wide body parser is JSON-only). Bad/missing signature or a disabled/unconfigured channel → 403. Otherwise responds `200 <Response/>` (`text/xml`) immediately, then parses + runs the pipeline.
- `POST /api/inbound/telegram/:secret` — JSON. Bad/missing `X-Telegram-Bot-Api-Secret-Token` or a disabled/unconfigured channel → 403 (the `:secret` path segment itself is not checked against anything; the header is the real credential). Otherwise responds `200 {"ok":true}` immediately, then parses + runs the pipeline.

Signed-in (role noted per route; `X-Org-Id` is required wherever "org-scoped" is noted, and access is checked the same way `middleware/org.ts` does — admins/owners bypass the org-membership check):
- `GET /api/inbound/status` (admin+) → `InboundStatus` = `{ channels: InboundChannelStatus[], bindings: number, transcription: { configured, provider } }`. Each `InboundChannelStatus` = `{ channel, configured, enabled, state: "listening"|"off"|"error", detail, webhookUrl, lastEventAt, counts: { today, published, failed, pending } }`. `test` is always `"listening"`; `twilio`/`telegram` are `"listening"` once configured + enabled (and, for Telegram, `webhookRegistered`), `"error"` when configured+enabled but the Telegram webhook isn't registered yet, else `"off"` with a `detail` explaining why.
- `GET /api/inbound/channels` (admin+) → `InboundChannelConfig[]` (one per channel, secrets masked).
- `PUT /api/inbound/channels/:channel` (admin+) body `inboundChannelConfigUpdateSchema` `{ enabled?, settings }` → `InboundChannelConfig`. Masked (`••••...`) values in `settings` are ignored (so re-saving a form with masked fields never wipes the stored secret); `""` clears a field. Saving Telegram settings with a `botToken` present automatically calls `getMe` then `setWebhook` (generating a secret token on first save) and records `webhookRegistered` + `botUsername`.
- `DELETE /api/inbound/channels/:channel` (admin+) → 204, removes all stored settings for that channel.
- `POST /api/inbound/channels/telegram/register` (admin+) → `InboundChannelConfig`, (re)runs `getMe` + `setWebhook`; 400 with Telegram's error message on failure.
- `GET/PUT /api/inbound/transcription` (admin+) → `PublicTranscriptionSettings` = `{ provider, apiKey (masked), updatedAt }`.
- `GET /api/inbound/bindings` (editor+; org-scoped via `X-Org-Id` for editors, every org for admin/owner) → `InboundBinding[]` (never includes `verificationCode`).
- `POST /api/inbound/bindings` (editor+, `X-Org-Id` required) body `inboundBindingCreateSchema` `{ channel, senderId, senderLabel?, connectionIds?, publishMode?, confirmBeforePosting? }` → `InboundBinding` (201) **including `verificationCode`** (6 digits, shown once). `?verified=true` creates it already `verified` (no code) — admin/owner only, 403 for editors.
- `PATCH /api/inbound/bindings/:id` (editor+, must own the binding's org unless admin/owner) body `inboundBindingUpdateSchema` → `InboundBinding`. Setting `status: "verified"` directly is admin/owner-only (403 for editors — editors verify a binding the normal way, by texting the code).
- `DELETE /api/inbound/bindings/:id` (editor+, same org rule) → 204.
- `GET /api/inbound/messages?limit&status&channel` (editor+; org-scoped via `X-Org-Id` for editors, every org for admin/owner) → `InboundMessage[]`, newest first, `limit` default 100 max 500.
- `GET /api/inbound/messages/:id` (editor+, org-scoped) → `InboundMessage`.
- `POST /api/inbound/messages/:id/confirm` and `POST /api/inbound/messages/:id/discard` (owner of the associated binding, or admin/owner; 400 if the message isn't `awaiting_confirmation`) → `InboundMessage`. `confirm` re-runs the pipeline as a synthetic `"yes"` from the same sender (so it goes through the exact same publish path a real reply would); `discard` sets `status: "ignored"` directly.
- `GET /api/inbound/stream` (any signed-in role) → Server-Sent Events, same shape as `/api/logs/stream`: `event: inbound\ndata: <InboundEvent JSON>\n\n`, a `: ping\n\n` comment every 20s. `InboundEvent` is `{ type: "message", message }` or `{ type: "status", status }`. Non-admins only see `message` events for their own org(s) (or org-less events, e.g. `unknown_sender`).
- `POST /api/inbound/test` (admin+) body `inboundTestMessageSchema` `{ senderId, text, imageUrl? }` → `InboundMessage`, runs synchronously.

### Reply texts (exact strings sent back to the chat)
- Verified: `Linked to <org name>. Send a photo with a caption to post.`
- Unknown sender: `This number isn't linked to suprstar. Ask an owner for a link code.`
- No photo/audio at all: `Send a photo with a caption to post.`
- Image too large: `That image is too large (max 15MB). Try a smaller photo.`
- Unsupported media type: `Only photos can be posted from chat right now.`
- Media download failed: `Couldn't download that photo; please try sending it again.`
- Nothing usable as a caption: `Saved as a draft: add a caption in suprstar.`
- Awaiting confirmation: `` `${caption}\n\nPosting to: ${targetNames}.\nReply YES to post or NO to discard.` ``
- Published: `Posted to <n> account(s):` then one `<label or platform> <url>` line per target.
- All targets failed: `Couldn't post to any accounts:` then one `<label>: <error>` line per target.
- Publish threw: `Couldn't post that: <error>`
- `yes`/`no` with nothing pending: no reply is sent (status `ignored`).

### Env / setting keys
No new environment variables — everything is stored in `app_settings` via `PUT /api/inbound/channels/:channel` and `PUT /api/inbound/transcription` (see Storage above). Twilio's signature check and Telegram's webhook registration both reuse the existing `PUBLIC_BASE_URL` (falling back to `CLIENT_URL`) to build the public webhook URL, exactly like the rest of the app's live-mode platform adapters.

### Tests
`server/src/__tests__/inboundAdapters.test.ts` (7 tests: Twilio signature accept/reject, Twilio MMS parse incl. a `whatsapp:` sender, Twilio reply request shape, Telegram secret-token accept/reject, Telegram photo parse via a stubbed `getFile`, Telegram `getMe`/`setWebhook` against a stubbed fetch) and `server/src/__tests__/inbound.test.ts` (10 tests: unknown sender, verification-code flow, caption+image publish, confirm-mode stage-then-YES-publish, voice-note-without-transcription draft, `/status` slash command via the agent, idempotent duplicate `providerMessageId`, `GET /status` counts/state, `GET /stream` SSE message event, and a role-guard test asserting a viewer gets 403 from `channels`/`status`). Both files stub outbound HTTP with an injectable `fetchImpl` (`setTwilioFetch`/`setTelegramFetch`/`setInboundFetch`, matching the `googleAuth.ts` pattern) so no real network calls are made.

## Backups
Not org-scoped; `owner`/`admin` only (`requireRole("admin")` at the mount point in `server/src/app.ts`). Implemented in `server/src/services/backup.ts`, routes in `server/src/routes/backups.ts`.

**How a backup is made**: `createBackup(db, { reason })` takes a consistent snapshot of the live database with SQLite's `VACUUM INTO` (works against both the on-disk db and an in-memory one), then shells out to the system `tar` (`child_process.execFile`, present in the Docker runtime image) to build **one gzipped tar** containing the snapshot as `db.sqlite` plus the whole `uploads/` tree, written to `<DATA_DIR>/backups/suprstar-<YYYYMMDD>-<HHMMSS>.tar.gz` (the timestamp is UTC). `<DATA_DIR>/backups` and `<DATA_DIR>/logs` are excluded from the archive so backups never nest inside each other. The temp snapshot is always removed afterwards, even on failure.

**Rotation**: after a successful backup, only the newest `BACKUP_KEEP` (default 7) local archives are kept; older ones are deleted and the prune is logged (source `backup`).

**Offsite copy**: when `BACKUP_S3_BUCKET` is set, the archive is also uploaded to S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2) via `@aws-sdk/client-s3`, at key `<BACKUP_S3_PREFIX>/<archive name>`. A failed upload is logged at `error` level and recorded on the result, but **never** fails the backup itself — the local archive is still worth keeping.

**Scheduler**: `startBackupScheduler(db, intervalMs)` (started in `server/src/index.ts` alongside the publish scheduler, hourly `intervalMs`) checks immediately on boot and then every `intervalMs` whether the newest local archive is older than `BACKUP_INTERVAL_HOURS` (default 24), and runs one if so — this is what performs catch-up after a restart. A shared in-flight flag stops the scheduler and a manual trigger from ever overlapping. Set `BACKUP_ENABLED=false` (or `0`) to disable the scheduler entirely (tests do this by default; see `server/vitest.config.ts`).

Every run, success, failure, prune, and offsite outcome is logged to source `backup` (`LogSource` now includes `"backup"`).

### Routes (`/api/backups`, owner/admin only)
- `GET /api/backups` → `{ status: BackupStatus, backups: BackupRecord[] }`. `backups` is the local `backups/` directory, newest first.
- `POST /api/backups` → runs one now (`reason: "manual"`), returns the `BackupRecord`; `201` on success, `500` if the archive itself failed (offsite failures don't affect this), `409` if a backup (manual or scheduled) is already running.
- `GET /api/backups/:name` → streams the archive (`Content-Type: application/gzip`, `Content-Disposition: attachment`). `name` must match `^suprstar-\d{8}-\d{6}\.tar\.gz$` and resolve inside the backups directory → `400` otherwise (including path-traversal attempts); unknown name → `404`.
- `DELETE /api/backups/:name` → removes one local archive (same name validation) → `204`; unknown name → `404`.

`BackupRecord = { name, createdAt, sizeBytes, reason, ok, durationMs, error?, offsite: { attempted, ok, key?, error? } }`. Entries listed straight from disk (rather than just-created) have `reason: "unknown"`, `ok: true`, `durationMs: 0` and `offsite.attempted: false` since no run metadata survives a restart for them — only the file itself does.

`BackupStatus = { lastAt, lastOk, lastError, lastSizeBytes, lastDurationMs, ageHours, local: { count, newest, totalBytes }, offsite: { configured, lastUploadedAt, lastError } }`. `lastAt`/`lastOk`/etc. come from in-memory state when this process has run a backup, otherwise fall back to the newest file on disk, so status is meaningful immediately after a restart; `local` and `offsite.configured` are always read fresh.

## Health / backups
`GET /health` additionally reports `backup: { lastAt, ageHours, ok }` (cheap: reads the backups directory, never runs one). `ok` is `false` when the newest archive is older than 2× `BACKUP_INTERVAL_HOURS` or the last run failed — this is what an uptime monitor should alert on.

### Env
`BACKUP_ENABLED` (default on; `false`/`0` disables the scheduler), `BACKUP_INTERVAL_HOURS` (default 24), `BACKUP_KEEP` (default 7), `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION` (default `auto`), `BACKUP_S3_ENDPOINT` (optional; set for R2/B2, forces `forcePathStyle: true`), `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_PREFIX` (default `suprstar`).

### Archive layout
```
suprstar-20260920-093000.tar.gz
├── db.sqlite       # VACUUM INTO snapshot of the live database (the running server's own file is named pulse.db, not db.sqlite)
└── uploads/        # the whole <DATA_DIR>/uploads tree, one subdirectory per organization
```

### Restore procedure
1. Get the archive onto disk: copy it directly, or `node scripts/fetch-backup.mjs [outputDir]` to pull the newest one from S3-compatible storage using the `BACKUP_S3_*` env vars above.
2. Preview first: `node scripts/restore-backup.mjs <archive.tar.gz> <dataDir> --dry-run` — extracts to a temp dir, sanity-checks that `db.sqlite` opens and has an `organizations` table, and prints exactly what a real run would do without touching anything.
3. Run it for real: `node scripts/restore-backup.mjs <archive.tar.gz> <dataDir> --force`. The script refuses to run without `--force`. It moves the *existing* data directory aside to `<dataDir>.pre-restore-<timestamp>` (never deletes it), then puts the restored `db.sqlite` (renamed to `pulse.db`, the name the server actually opens) and `uploads/` in place.
4. Restart the service (the script reminds you to). If something's wrong, the pre-restore directory is still sitting right next to it.

### Tests
`server/src/__tests__/backup.test.ts` (13 tests): archive contents (tar-extracted, `db.sqlite` + `uploads/` present, `backups/`/`logs/` absent), the restored snapshot opens with matching tables and row counts, rotation keeps exactly `BACKUP_KEEP` archives and drops the oldest, status/health report age/size/count and flip `ok: false` on a failed run or an artificially zeroed interval, a concurrent `runBackup` call is rejected, the scheduler runs immediately when no archive exists and skips when a fresh one is present (and is a no-op when `BACKUP_ENABLED=false`), offsite upload (S3 client mocked via `vi.mock("@aws-sdk/client-s3")`) hits the expected bucket/key and a failed upload leaves the local archive with a recorded error, and route guards (owner list/create/download/delete, viewer/editor 403, a `409` on an in-flight run, `400` on a path-traversal name, `404` on an unknown one).
