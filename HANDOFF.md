# suprstar handoff

Everything a new session needs to pick this project up. No secrets live in this file; it points at
where each one is kept.

Last updated 2026-09-20.

---

## 1. What this is

**suprstar** plans, publishes and monitors social media across five platforms (TikTok, YouTube,
LinkedIn, Instagram and X) for multiple organizations. It also accepts posts remotely: from a
phone through a private link, or by texting a photo to a linked number or chat bot.

Three organizations exist in production: **F3i**, **Larkspur Health** and **Enel Health**.

Every platform connection is in **sandbox mode**, which simulates connect, test, publish and
metrics deterministically. Nothing has published to a real social network yet. Switching a
connection to live requires real OAuth credentials for that platform (see section 9).

---

## 2. Live services

| Thing | Where |
| --- | --- |
| App (client) | https://suprstar.social (Vercel, project `prj_v4zmwaN7fBgZLtxzPkcpKtPXHU3k`) |
| API | https://suprstar-api.onrender.com (Render service `srv-dan09njtqb8s73a3v5s0`, Starter plan, 5 GB disk at `/data`) |
| Repository | https://github.com/jameschrisa/socmedia, branch `main` |
| Older client URL | https://socmedia-eight.vercel.app, still serves but is no longer canonical |

`www.suprstar.social` redirects to the apex with a 308. TLS is a Let's Encrypt certificate that
renews automatically. Vercel rewrites `/api` and `/uploads` through to Render, so the browser only
ever talks to one origin and the session cookie works.

**Both hosts auto-deploy from `main` today.** A push goes straight to production with nothing
checking it first. Fixing that is the top punchlist item.

---

## 3. Repository layout

npm workspaces, Node 24, TypeScript throughout.

```
shared/     types, zod schemas, platform specs, post validation  (the contract both sides import)
server/     Express 4, node:sqlite, tsx runtime, platform adapters, scheduler, services, routes
client/     Vite + React 18 + Tailwind 3, TanStack Query, Zustand, Framer Motion, Konva
e2e/        Playwright suite (15 spec files) + QA-REPORT.md
docs/       API.md (the API contract), CI.md, ci-workflow.yml, platforms/ (offline dev docs)
ops/        operator credential template and checker
scripts/    font fetcher, backup restore and fetch helpers
```

Key entry points:

- `server/src/app.ts` mounts every router; `server/src/index.ts` boots the HTTP server, the
  publish scheduler, the backup scheduler and the terminal WebSocket.
- `client/src/App.tsx` holds the routes; `client/src/components/layout/TopNav.tsx` holds the tabs.
- `shared/src/platforms.ts` is the single source of truth for platforms, formats and limits.
  Adding a platform means touching every `Record<Platform, ...>` the typechecker flags.

---

## 4. Running it locally

```bash
npm install
cp .env.example .env          # then fill in what you need
npm run dev                   # API on :4000, web on :5173
```

The API dev script loads the root `.env`. A useful local `.env` sets `ADMIN_EMAIL`,
`ADMIN_PASSWORD` and `ADMIN_NAME` to bootstrap an owner on first run, plus `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` if you want to exercise Google sign-in.

Checks:

```bash
npm run typecheck
npm test              # shared, server, client
npm run build
npx playwright test   # starts its own API on 4100 and web on 5174
```

The end-to-end suite deliberately uses different ports so it never collides with a running dev
server. It wipes `./data/e2e` on every run.

---

## 5. Credentials and access

**Operator keys** (Render, Vercel) live in `ops/.env.ops`, which is gitignored. Copy
`ops/.env.ops.example`, paste values in with an editor, and run `bash ops/check.sh` to verify them.
The checker prints only `ok`, `not set` or `FAILED`, never a value, so its output is safe to paste
anywhere. Read `ops/README.md` first.

**The GitHub token** lives in the macOS keychain, not in that file, and can be read back
programmatically without being displayed. It currently **lacks `workflow` scope**, which is why
the CI workflow cannot be pushed yet.

**Application secrets** live only as environment variables on Render and are never copied into the
repository: `SECRET_KEY`, the Google client secret, AI provider keys, and (once configured) the
mail and Entra secrets.

> `SECRET_KEY` must never be rotated casually. It signs session cookies **and** encrypts stored
> platform credentials at rest, so changing it signs everyone out and makes saved platform tokens
> undecryptable. It was verified as a strong 64-character random value on 2026-09-20.

**Sign-in to the hosted app**: the owner is `james.christopher@holistiplan.com`. Its password was
generated during setup and is not recorded here. If it is lost, sign in with Google or reset it by
temporarily setting `ADMIN_*` on Render with an empty database, or add a new owner from an existing
admin account.

---

## 6. What is built

**Navigation**: Overview, Calendar, Studio, Remote Posting, AI Assistant, Social Profiles,
Analytics, Settings, plus a full-page Console at `/console`.

- **Calendar** month and week views, drag creatives onto a day, an iOS-style time wheel, approve,
  publish now, duplicate, best-time suggestions.
- **Studio** media library with a Konva image editor (crop to platform presets, filters and
  presets, text layers, stickers, brand badge) and a video clip editor (dual-handle trim, crop to
  format, mute, save as new or replace). Uploads are capped at five minutes.
- **Composer** per-platform targets with their own format and caption overrides, live previews,
  shared validation, scheduling, approvals.
- **Multiple accounts per platform** with publish modes "all at once" or a spaced queue, deferred
  jobs, and idempotency per post and account.
- **AI Assistant** at `/assistant`: captions, ideas, hashtags, improve, and a best-times heatmap.
  Runs against Anthropic or Moonshot, falling back to a deterministic offline mock. Production is
  currently on Moonshot.
- **Remote Posting** tab: phone links (QR, one-time token, iOS Shortcut), chat channels (Twilio
  SMS/MMS/WhatsApp, Telegram, and a test channel), a "needs a caption" queue, an activity feed, and
  a table of every post that arrived remotely.
- **Console** at `/console`: a live activity log over server-sent events with filters and log
  files, an agent command line (slash commands plus natural language with tools), and an optional
  OS terminal over WebSocket, restricted to owners and admins and disabled in production unless
  `OS_TERMINAL=on`.
- **Authentication**: password, Google, magic links, and Microsoft Entra (in flight). Roles are
  owner, admin, editor and viewer. A sign-in policy maps email domains to a role and organizations:
  `enelhealth.com` to editor on Enel Health, `f3insights.com` to editor on F3i. Users an admin
  invited can sign in from any domain. Everyone else is refused and pointed at a request-access
  page, whose requests appear in Settings for approval.
- **Backups**: nightly archive of the database and uploads, local rotation, optional upload to
  S3-compatible storage, a restore script, and backup age reported in the health endpoint.
- **Platform documentation** under `docs/platforms/` is indexed and searchable by the agent through
  `/docs` and `/diagnose`, and from the Documentation rail.

Test counts at handoff: shared 14, server 223, client 265, Playwright 87 passing with one
environment-dependent skip.

---

## 7. Where we left off

**Microsoft Entra sign-in is built on both sides and merged.** The client shows a "Continue with
Microsoft" button whenever the server reports `providers.entra`, and the server has
`/api/auth/entra/start` and `/api/auth/entra/callback`, an `entraSub` column, and full id token
validation: RS256 signature against the tenant's JWKS, plus `aud`, `iss`, `tid`, `exp` and `nonce`
checks. It is inert until three environment variables are set on Render, which is punchlist item 5.

**The mail self-test is built.** Settings has an Email delivery card showing the provider, the from
address, whether magic links can be delivered, and a Send a test email button backed by
`GET /api/settings/mail` and `POST /api/settings/mail/test`. Magic links stay dark in production
until a provider is configured, which is punchlist item 4.

**A trap was removed along the way.** Any account an admin creates carries a temporary password and
a "must change it" flag, which would have demanded a password from someone signing in through
Microsoft, Google or an emailed link who never had one. Federated sign-in now clears that flag and
preserves the account's existing role, so an owner signing in with Microsoft stays an owner rather
than being downgraded to the domain default.

**The operator's Microsoft identity is `james@f3insights.com`**, and they administer that tenant.
That address sits on a domain the sign-in policy already maps to editor on F3i, so an account was
pre-created for it as an **owner with access to every organization**. Because the account already
exists, the first Microsoft sign-in will match it and keep owner rights instead of provisioning a
fresh editor. The separate `james.christopher@holistiplan.com` owner account still works.

## 8. Punchlist

Ordered by value. The first three are the ones that make this reliable for someone else to run.

1. **Install the CI workflow.** It is parked at `docs/ci-workflow.yml` because the GitHub token
   cannot push anything under `.github/workflows` and a rejected workflow file fails the whole push.
   Give the token `workflow` scope (classic) or Workflows set to read and write (fine-grained), then
   `git mv docs/ci-workflow.yml .github/workflows/ci.yml` and push. Full steps in `docs/CI.md`.
2. **Gate deploys on CI.** Create a deploy hook in each dashboard, add them as the repository
   secrets `RENDER_DEPLOY_HOOK` and `VERCEL_DEPLOY_HOOK`, then turn off auto-deploy on both hosts.
   Until this is done, CI only reports after a bad commit has already shipped.
3. **Configure offsite backups.** Backups already run nightly onto the Render disk, which does not
   protect against losing that disk. Set `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`,
   `BACKUP_S3_SECRET_ACCESS_KEY` and, for Cloudflare R2 or Backblaze B2, `BACKUP_S3_ENDPOINT`. Then
   rehearse a restore with `node scripts/restore-backup.mjs <archive> <dataDir> --dry-run`.
4. **Turn on mail so magic links work.** Create a Resend account, add `suprstar.social` as a sending
   domain, add the DKIM records at the registrar, and set `MAIL_PROVIDER=resend`, `RESEND_API_KEY`
   and `MAIL_FROM` on Render. An SMTP URL works instead. Verify with the Send a test email button.
5. **Switch Entra on.** The code is done; this is configuration only. In the Entra admin center
   register an app: single tenant, redirect URI `https://suprstar.social/api/auth/entra/callback`
   (add `http://localhost:5173/api/auth/entra/callback` for development). Copy the Application
   (client) ID and Directory (tenant) ID, create a client secret, then set `ENTRA_CLIENT_ID`,
   `ENTRA_TENANT_ID` and `ENTRA_CLIENT_SECRET` on Render. No API permissions need adding; the
   delegated `openid`, `profile` and `email` scopes are the defaults.
6. **Replace the GitHub token** and, optionally, the Render and Vercel keys. All three were shared
   in a conversation. None are used by the running application, so revoking them breaks nothing;
   the GitHub one matters most because write access reaches production through the deploy path.
7. **Change the owner password** in the app (user menu, Change password), then remove `ADMIN_EMAIL`,
   `ADMIN_PASSWORD` and `ADMIN_NAME` from Render so no standing credential remains. Those variables
   only create an owner when the database has no users, so removing them cannot lock anyone out.
8. **Add monitoring.** Nothing alerts today. Point an uptime check at `/api/health`, which reports
   scheduler and backup health, and add an exception tracker. A silently dead scheduler currently
   looks exactly like a quiet week.
9. **Go live on real platforms.** Each needs its own developer app and review: TikTok requires an
   audit before public posts, Instagram and Facebook need app review, YouTube has a per-upload quota
   cost, LinkedIn needs partner access, and X requires a paid tier for useful volume. What each one
   asks for is written up under `docs/platforms/`.
10. **Cap AI spend.** The assistant and the console agent both call a live provider key with no
    per-organization limit or usage tracking.
11. **Write a runbook.** One page covering how to invite a user, rotate a key, read the console when
    a post fails, and restore a backup. The README and `docs/API.md` describe the system, not the
    operating procedures.

---

## 9. Conventions that matter

- **Design**: dark glass by default with a light mode. Square corners everywhere except badges,
  chips, toggles and the sign-in card. Glow Cyan `#59d8e6` accent with dark text on filled buttons.
  Outfit for everything including headings; no serif in UI chrome (Playfair remains only as a
  selectable Studio editor font). Sentence case, no em-dashes, no emojis in product copy.
- **Testing**: every feature lands with unit tests, and user-visible flows get a Playwright spec.
  `e2e/QA-REPORT.md` tracks rounds and defects. The convention this project has used is to keep a
  failing test asserting correct behaviour when a real defect is found, rather than softening it.
- **The API contract** lives in `docs/API.md` and is kept current. Org scoping is the `X-Org-Id`
  header. Roles are enforced server-side, not just hidden in the UI.
- **Work pattern**: build with agents in parallel, then run a QA pass and a UX pass over the result
  before committing. That cadence caught most of the real defects in this project.

---

## 10. Gotchas worth knowing before you change things

- **Tailwind config edits need a dev-server restart**, otherwise classes appear not to exist.
- **Never use Tailwind opacity modifiers on the translucent CSS variable tokens** (`bg-ink-50/60`).
  They replace the base alpha and render as pale blocks. Use the base token.
- **Dropdowns, menus and modals must render through a portal.** `backdrop-filter` creates stacking
  contexts that trap `z-index`, which is why `components/ui/Portal.tsx` exists.
- **The drift animation keyframes must end with `transform: none`**, or fixed-position modals inside
  an animated route wrapper are mispositioned.
- **Server-sent event routes must write a first byte** (a `: connected` comment) immediately after
  the headers, or proxies buffer the response and the browser never fires `open`.
- **`node-pty` is loaded through a non-literal import specifier** so the Docker image, which has no
  compiler, still typechecks and builds. The terminal falls back to pipes there.
- **Do not add `--omit=optional` to `npm ci` in the Dockerfile.** It also removes Rollup's and
  sharp's platform binaries and the build fails.
- **Render deploys have brief downtime** because a disk can attach to only one instance, and the API
  returns 502 for a few seconds during the swap. Retry rather than assuming a failed deploy.
- **Konva cannot load in jsdom**, so client tests that touch the image editor mock `react-konva`,
  `konva` and `use-image`.
- **The Anthropic SDK's `zodOutputFormat` requires zod v4 schemas**, so `server/src/services/ai.ts`
  imports from `zod/v4` for its response schemas only.
- **Adding a platform** touches `shared/src/platforms.ts` plus every `Record<Platform, ...>` map the
  typechecker flags, and `ensurePlatformCoverage()` at startup backfills accounts for organizations
  that predate the new platform.
