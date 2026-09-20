# QA Report — suprstar e2e suite

Run with `npx playwright test` from the repo root. Config: `playwright.config.ts` (root) + helpers/specs under `e2e/`.

- Total: **74 tests**, **73 passing**, **1 skipped (environment-dependent, not a defect — see "Round 4" below)**, **0 failing**. Verified deterministic across multiple full-suite runs, on top of the determinism already established in Rounds 1-3.
- **Both Round 1 defects and the Round 3 defect are now fixed in the application code** and their tests pass unmodified — see "Round 1 defects: now fixed" and "Round 3 defect: now fixed" below. Round 2 (console, agent, quick post, sign-in video) found no new defects. **Round 4 (X platform, full-page console, terminal, platform docs) found no new hard-failing defects** — one test is conditionally skipped for an environment-dependent reason explained below, and one pre-existing test needed a small update for the intentional addition of a 5th platform (not a defect) — see "Round 4: X platform, full-page console, terminal, platform docs" below.
- Environment: API on `:4100`, web on `:5174` (own Vite dev server instance, HMR disabled for that instance — see "Environment notes" below), isolated `DATA_DIR=./data/e2e` wiped by `globalSetup` on every run. Bootstrap owner: `qa@suprstar.test` / `qa-password-123` (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`), storage state cached at `e2e/.auth/owner.json` after `auth.setup.ts`. As of Round 3, the API's `CLIENT_URL` is also pinned to the e2e web port (`:5174`) — see "Round 3" for why.

## Pass/fail table

Order matches an actual `npx playwright test` run (files execute roughly alphabetically after the `setup` project).

| # | File | Test | Result |
|---|------|------|--------|
| 1 | auth.setup.ts | authenticate as owner | ✅ pass |
| 2 | access.spec.ts | filling the request-access form shows a confirmation, and submitting again is rejected as a duplicate | ✅ pass |
| 3 | access.spec.ts | owner sees the pending badge and row in Settings -> Access requests | ✅ pass |
| 4 | access.spec.ts | approving with role editor and all organizations shows a temporary password | ✅ pass |
| 5 | access.spec.ts | the newly approved user signs in with the temporary password, is forced to change it, and lands on Overview | ✅ pass |
| 6 | access.spec.ts | declining a second request moves it out of Pending and into Declined | ✅ pass |
| 7 | access.spec.ts | owner adds domain example.org scoped to Larkspur Health as viewer, saves, and it persists | ✅ pass |
| 8 | access.spec.ts | a magic link for viewer@example.org now succeeds and provisions a viewer scoped only to Larkspur Health | ✅ pass |
| 9 | access.spec.ts | removing the domain and saving takes it out of the policy | ✅ pass |
| 10 | access.spec.ts | an invalid domain "not a domain" is rejected inline and never added | ✅ pass |
| 11 | access.spec.ts | the "Invited users may sign in..." checkbox toggles and persists | ✅ pass |
| 12 | access.spec.ts | a viewer gets 403 on GET /api/users/access-requests and PUT /api/settings/access-policy | ✅ pass |
| 13 | access.spec.ts | PUT /api/settings/access-policy with role owner is rejected 400 | ✅ pass |
| 14 | auth.spec.ts | unauthenticated visit shows the sign-in page, not the dashboard | ✅ pass |
| 15 | auth.spec.ts | wrong password shows an error and does not sign in | ✅ pass |
| 16 | auth.spec.ts | correct login lands on Overview with the org switcher | ✅ pass |
| 17 | auth.spec.ts | sign out from the user menu returns to sign-in | ✅ pass (was ❌ Defect 1 in Round 1 — now fixed) |
| 18 | auth.spec.ts | API returns 401 for /api/orgs without a session cookie | ✅ pass |
| 19 | connections.spec.ts | adding a second TikTok account lets a post queue across both | ✅ pass |
| 20 | console.spec.ts | rail-console opens /console with both panes, Ctrl+\` toggles it, and Close returns to the previous route | ✅ pass |
| 21 | console.spec.ts | rail-console-mobile opens the console on a narrow viewport | ✅ pass |
| 22 | console.spec.ts | the split handle resizes the panes from the keyboard and the split persists across a reload | ✅ pass |
| 23 | console.spec.ts | console-right-tab toggles between Activity log and Terminal | ✅ pass |
| 24 | console.spec.ts | the Activity log pane shows recent server activity and streams a new line via a request in the same browser context | ✅ pass |
| 25 | console.spec.ts | filters narrow the visible log lines by source and by text | ✅ pass |
| 26 | console.spec.ts | slash commands: /status, /help, /whoami, /docs, an offline-mock reply, /clear and history recall | ✅ pass |
| 27 | console.spec.ts | /diagnose x reports the org's X account status | ✅ pass |
| 28 | console.spec.ts | Documentation rail search finds a YouTube/Google hit for redirect_uri_mismatch | ✅ pass |
| 29 | console.spec.ts | owner sees a Log files tab listing rotated app logs with viewable content | ✅ pass |
| 30 | console.spec.ts | a viewer has no Log files tab, is 403'd from the files API, and gets a refusal (not a publish) from a write slash command | ✅ pass |
| 31 | login.spec.ts | a signed-out visit renders the looping background video with a poster and an mp4 source | ✅ pass |
| 32 | login.spec.ts | prefers-reduced-motion renders the poster image instead of a video | ✅ pass |
| 33 | login.spec.ts | both background media files are served as the right content type | ✅ pass |
| 34 | orgs.spec.ts | Enel Health is seeded on a fresh database and shows its handle everywhere | ✅ pass |
| 35 | orgs.spec.ts | a new demo organization can be seeded from the larkspur profile with identity overrides | ✅ pass |
| 36 | quick.spec.ts | Settings -> Quick post from your phone: creating a link shows the reveal dialog and lists the new link | ✅ pass |
| 37 | quick.spec.ts | the public phone page shows the org and an Instagram chip, and refuses to post without a photo | ✅ pass |
| 38 | quick.spec.ts | uploading a photo and a caption posts immediately and shows a live link | ✅ pass |
| 39 | quick.spec.ts | multipart edge cases: missing caption needs a caption, a transcript is used as-is, unknown tokens 404 | ✅ pass |
| 40 | quick.spec.ts | a deactivated token shows the invalid-link message on the phone page | ✅ pass |
| 41 | quick.spec.ts | revoking the link removes it from the table | ✅ pass |
| 42 | signin.spec.ts | shows the heading, the magic-link form, no Google button, the domains footer and a Request access link | ✅ pass |
| 43 | signin.spec.ts | "Use a password instead" reveals the password form (Email + Password) | ✅ pass |
| 44 | signin.spec.ts | ?auth=error&reason=expired shows the expired notice and the query string is stripped from the URL | ✅ pass |
| 45 | signin.spec.ts | nurse@enelhealth.com signs in via a magic link, is auto-provisioned editor scoped to Enel Health, and the link is single-use | ✅ pass (was ❌ Defect 3 in Round 3 — now fixed; the `expect.soft` org-switcher/current-org assertion left in the test now genuinely holds) |
| 46 | signin.spec.ts | someone@gmail.com gets an inline 403 naming the allowed domains | ✅ pass |
| 47 | signin.spec.ts | API: a disallowed domain gets 403 reason domain; an invited user (any domain) gets 200 | ✅ pass |
| 48 | signin.spec.ts | a deactivated user's magic-link request is refused with reason inactive | ✅ pass |
| 49 | smoke.spec.ts | API health and seeded organizations (authenticated) | ✅ pass (updated in Round 4 — see below) |
| 50 | smoke.spec.ts | navigates between primary tabs | ✅ pass |
| 51 | smoke.spec.ts | switches organization and scopes data | ✅ pass |
| 52 | smoke.spec.ts | social profile cards flip to reveal configuration | ✅ pass |
| 53 | smoke.spec.ts | connection test returns a result in sandbox mode | ✅ pass |
| 54 | smoke.spec.ts | calendar renders the month grid with scheduled posts and a week view | ✅ pass |
| 55 | smoke.spec.ts | new post opens the composer with platform targets and time scroller | ✅ pass |
| 56 | smoke.spec.ts | AI assistant generates captions (mock or live) | ✅ pass |
| 57 | smoke.spec.ts | analytics page shows KPIs after sync | ✅ pass |
| 58 | terminal.spec.ts | owner: the Terminal tab shows the host line with the shell path and an xterm container | ✅ pass |
| 59 | terminal.spec.ts | typing 'echo suprstar-e2e' into the xterm produces it in the rendered output | ⚠️ **skipped** — this host's `node-pty` silently falls back to a plain-pipe shell per session even though `GET /api/terminal/status` reports `pty: true`; see "Round 4" below |
| 60 | terminal.spec.ts | Disconnect and Restart shell work | ✅ pass |
| 61 | terminal.spec.ts | a viewer sees the disabled explanation and GET /api/terminal/status reports enabled: false with a reason | ✅ pass |
| 62 | terminal.spec.ts | an unauthenticated WebSocket to /api/terminal is refused | ✅ pass |
| 63 | users.spec.ts | owner invited an editor and a viewer with temporary passwords shown | ✅ pass |
| 64 | users.spec.ts | invited users appear in the Users & access table with their roles | ✅ pass |
| 65 | users.spec.ts | viewer cannot see New post and the API rejects a viewer's post creation with 403 | ✅ pass |
| 66 | users.spec.ts | editor can save a draft post from the composer but has no Users section in Settings | ✅ pass (was ❌ Defect 2 in Round 1 — now fixed) |
| 67 | video.spec.ts | shows the upload size hint and refuses a video over 5:00 client-side | ✅ pass |
| 68 | video.spec.ts | uploads a video, shows its duration, and trims a vertical clip via the scissors editor | ✅ pass |
| 69 | x.spec.ts | Social Profiles shows an X card per org, among all 5 platform groups | ✅ pass |
| 70 | x.spec.ts | Connect on X in sandbox mode marks it connected with a handle, and the authorize URL uses PKCE (S256) | ✅ pass |
| 71 | x.spec.ts | composer: an X-only 281-char caption trips the 280 limit and blocks Publish now; trimming to 280 clears it | ✅ pass |
| 72 | x.spec.ts | publish now on X succeeds and the job's URL is on x.com (API) | ✅ pass |
| 73 | x.spec.ts | the calendar platform filter includes X | ✅ pass |
| 74 | x.spec.ts | Analytics renders an X series in the Engagement-by-platform chart after syncing a connected X account | ✅ pass |

## Round 1 defects: now fixed

Both defects below were filed against the app code as it stood at the end of Round 1. Re-running
`e2e/auth.spec.ts` and `e2e/users.spec.ts` unmodified at the start of Round 2 shows both now pass:
`client/src/hooks/useAuth.ts`'s `logout` no longer calls `qc.clear()` before `setQueryData` (the
stale-observer race described below no longer applies), and `server/src/routes/orgs.ts`'s org-mutation
guard is now scoped to `router.use("/orgs", ...)` instead of the router's shared `"/api"` mount, so
editors reach the real `requireWrite` check on `/api/posts` and friends. Left here for the historical
record; no test changes were needed to pick up the fix.

## Defect 1 (Round 1, fixed) — Signing out doesn't update the UI until the page is reloaded

**Severity:** Medium (session actually ends server-side; the client just doesn't reflect it).

**Where:** `client/src/hooks/useAuth.ts`, `useAuthMutations().logout`, lines ~70-77:

```ts
const logout = useMutation({
  mutationFn: () => api.auth.logout(),
  onSuccess: () => {
    qc.clear();
    qc.setQueryData<AuthState>(qk.auth, SIGNED_OUT);
  },
});
```

**Repro steps:**
1. Sign in normally.
2. Open the user menu (`user-menu-trigger`) and click "Sign out".
3. Observe the page: the dashboard (Overview, org switcher, nav) stays fully rendered and interactive.
4. Check `document.cookie` — the `suprstar_session` cookie is already gone, and a manual page reload correctly lands on the sign-in screen.

**Expected:** Clicking "Sign out" returns the user to the sign-in screen immediately, same as after a reload.

**Actual:** The UI keeps showing the previous session's dashboard indefinitely (confirmed waiting 2s+) even though the server has already cleared the session cookie (`POST /api/auth/logout` correctly returns `204` and clears the cookie).

**Root cause (confirmed by a temporary local repro, reverted before finishing this task):** the `onSuccess` handler calls `queryClient.clear()` and then immediately `queryClient.setQueryData(qk.auth, SIGNED_OUT)` in the same synchronous callback. `clear()` removes every cached query (including the auth query the mounted `useAuth()` observer is subscribed to); the very next `setQueryData` recreates a *new* query object for that key, but the already-mounted observer does not react to it, so `useAuth()` keeps returning its last rendered (stale, authenticated) value until something else forces a re-render (e.g. a full reload, which starts fresh). Removing the `qc.clear()` call (leaving only `setQueryData`) fixes the symptom immediately — that isolates the cause but isn't a fix I'm applying, since it would also need to make sure other cached org-scoped queries (media/posts/connections/etc.) still get dropped on logout, just via a route that doesn't fight the auth-query observer (e.g. call `setQueryData` first, then `qc.removeQueries({ predicate: q => q.queryKey !== qk.auth })`, or clear on the *next* tick).

**Test:** `e2e/auth.spec.ts` → "sign out from the user menu returns to sign-in" (left asserting the correct/expected behavior; it fails against current app code, which is exactly what should happen for a real defect rather than being softened to force a green run).

## Defect 2 (Round 1, fixed) — Editors (and any non-admin role) cannot create/update any post, media, job, analytics or AI resource — every write is wrongly blocked with 403

**Severity:** High (breaks the entire "editor" role as documented; also affects any future ≥viewer/<admin role on these routes).

**Where:** `server/src/app.ts` line ~39 (`app.use("/api", orgsRouter(db));`, mounted *before* the more specific `/api/posts`, `/api/media`, `/api/jobs`, `/api/analytics`, `/api/ai` mounts) combined with the unscoped guard in `server/src/routes/orgs.ts` lines ~94-101:

```ts
export function orgsRouter(db: Db): Router {
  const router = Router();
  ...
  // Reading the org list/detail is available to any signed-in user; every mutation is admin+.
  router.use((req, res, next) => {
    if (req.method === "GET") { next(); return; }
    requireRole("admin")(req, res, next);
  });
  ...
```

Because `orgsRouter` is mounted at the broad prefix `"/api"` (not `"/api/orgs"`), and Express treats `app.use(path, ...)` as a *prefix* match, **every** non-GET request under `/api/*` — including `/api/posts`, `/api/media/:id`, `/api/jobs/:id/retry`, `/api/analytics/sync`, `/api/ai/*` — is first routed *through* `orgsRouter`. Its blanket `router.use(...)` guard (registered with no path filter, so it runs for literally any path reaching this router) fires before Express ever gets to the intended, more specific mount further down in `app.ts`, and requires `admin`+ for any method other than GET. An `editor` (or `viewer`) never reaches the real `requireWrite` (`editor`+) check on `/api/posts` etc. — they're rejected two mounts too early by an org-mutation guard that was only ever meant to gate `/api/orgs*` routes.

**Repro steps (confirmed both through the UI and directly against the API, bypassing the client and the Vite proxy):**
1. As an owner, invite a user with role `editor` (Settings → Users & access → Invite user).
2. Sign in as that editor (after completing the forced password change).
3. `POST /api/posts` with a valid minimal body and a valid `X-Org-Id` the editor has access to (they have `orgIds: "*"`).

**Expected:** `201 Created` with the new draft post (per `docs/API.md`: "editor can create/edit/publish within their orgs" and `ROLE_CAPABILITIES.editor.write === true`).

**Actual:** `403 { "error": "Forbidden" }` — same result even hitting the API port (`4100`) directly with curl, so it's not a proxy/CORS/cookie artifact. The same class of request would also incorrectly 403 for editors on `PATCH/DELETE /api/media/:id`, `POST /api/jobs/:id/retry`, `POST /api/analytics/sync`, and `POST /api/ai/*` — anything mounted after `orgsRouter` in `app.ts`. Owners/admins never notice because they satisfy the accidental `admin` check and fall through to the real, correctly-scoped middleware.

**Suggested fix direction (not applied — app code is out of scope for this task):** scope the guard to the org-mutation routes only, e.g. `router.use("/orgs", (req, res, next) => { ... })`, or apply `requireRole("admin")` directly on the individual mutating `/orgs*` route definitions instead of a path-less `router.use()` on a router that's mounted at a shared `"/api"` prefix.

**Test:** `e2e/users.spec.ts` → "editor can save a draft post from the composer but has no Users section in Settings" (the composer's "Save draft" button correctly attempts `POST /api/posts`; the request is rejected, so the drawer never closes — left asserting the correct/expected behavior).

## Round 2: console, agent, quick post

Scope: `e2e/console.spec.ts` (right-rail Console drawer, live log stream, filters, slash commands,
agent fallback, Log files tab and its role gating), `e2e/quick.spec.ts` (Settings → "Quick post from
your phone" link management, the public `/go/:token` phone page, and the multipart submission API's
edge cases), and `e2e/login.spec.ts` (the sign-in page's background video / reduced-motion / static
file serving). Read against `docs/API.md`'s "Activity log", "Agent console" and "Quick post from a
phone" sections and the corresponding client code before writing tests.

**Result: no new defects found.** Every specified behavior — the drawer open/close/toggle/resize/persist
cycle, the SSE stream picking up a triggered request live, source and text filtering, all six slash-command
paths (`/status`, `/help`, `/whoami`, the offline-mock fallback for free-form input, `/clear`, history
recall), the owner-only Log files tab and its 403 for viewers, the full quick-post link lifecycle
(create → reveal-once dialog → phone page → photo+caption publish → multipart edge cases →
deactivate → revoke), and the sign-in page's video/reduced-motion/static-file behavior — matched the
documented and coded behavior. Verified deterministic across 3 consecutive full-suite runs (39/39
passing every time) plus several isolated re-runs of `console.spec.ts` and `quick.spec.ts` while writing
them.

Two testability quirks worth recording even though neither is a functional bug:

1. **React doesn't reflect the `<video muted>` prop as an HTML attribute.** `client/src/features/auth/LoginPage.tsx`'s `LoginBackground` sets `muted` (along with `autoPlay`, `loop`, `playsInline`) directly as JSX props on the `<video>` element, and the element *is* muted at runtime (confirmed via `element.muted === true`, and via it actually autoplaying, which Chromium only allows for muted video) — but React applies `muted` as a DOM property rather than an HTML attribute for media elements, so `outerHTML`/`toHaveAttribute("muted", ...)` never sees it. This is documented upstream React behavior, not a defect. `e2e/login.spec.ts` asserts `loop`/`playsinline`/`poster` as attributes but `muted` via `toHaveJSProperty("muted", true)` instead.
2. **Rendered console log lines have no whitespace between the time/level/source/message spans in the DOM text.** `client/src/features/console/LogLine.tsx` lays the four `<span>`s out with a CSS `gap` (`flex gap-x-2`), which only adds *visual* spacing — the actual `textContent` (what `page.locator(...).allTextContents()` reads) concatenates them directly, e.g. `"14:12:34infohttpGET /api/auth/me 200 1ms"`. Also, the `LEVEL`/`source` cells are visually uppercased via a CSS `text-transform: uppercase` class, but the underlying text is the lowercase `LogEntry.level`/`.source` value. Neither affects a sighted user (the CSS handles both), but a test written against the naive assumption (`"HH:mm:ss  LEVEL  source  message"` with real separators, as `LogLine.tsx`'s own doc-comment literally describes it) fails to match anything. `e2e/console.spec.ts`'s `LOG_LINE_RE` accounts for both.

## Round 3: sign-in methods and access

Scope: the redesigned sign-in page (magic link as the primary method, Google as an optional
secondary one that's off in this environment, password behind "Use a password instead"),
`POST/GET /api/auth/magic/*`, the self-serve access policy (`GET/PUT /api/settings/access-policy`,
`SignInPolicyCard`), and the access-request flow (`POST /api/auth/access-requests`,
`GET/POST /api/users/access-requests*`, `AccessRequestsCard`, `/request-access`). Read against
`docs/API.md`'s "Authentication & users" section (including "Magic links", "Access policy" and
"Access requests") and the corresponding client code (`LoginPage.tsx`, `AuthShell.tsx`,
`RequestAccessPage.tsx`, `SignInPolicyCard.tsx`, `AccessRequestsCard.tsx`) before writing tests.
New specs: `e2e/signin.spec.ts` (sign-in page copy/toggle, magic-link happy path and single-use
enforcement, disallowed domains, deactivated users) and `e2e/access.spec.ts` (request-access flow
end to end including approve/decline, the sign-in policy card's domain CRUD and persistence, and
API-level role guards).

**Existing tests updated first, per the task, to keep passing under the new sign-in page:**
`e2e/auth.setup.ts` and every UI login in `e2e/auth.spec.ts` now click "Use a password instead"
before filling the password form (the page now defaults to the magic-link form since
`providers.magicLink` is true in this environment); `e2e/login.spec.ts`'s two heading assertions
were updated from "Sign in" to the new copy, "Only authorized suprstars allowed". A new shared
helper, `signInWithPassword(page, email, password)`, was added to `e2e/helpers.ts` for this and
reused by the new specs. `signInFreshUser` in `e2e/helpers.ts` needed no change — it drives
`POST /api/auth/login` directly rather than the UI, so it's unaffected by the sign-in page redesign.

**Test-harness fix (not an app defect):** `playwright.config.ts`'s API `webServer` command did not
set `CLIENT_URL`, so the API fell back to its default (`http://localhost:5173`) — the *other*,
unrelated dev server's port, not this suite's own web server on `:5174`. Every link the API embeds
in its own responses (the magic-link "click me" URL returned by `POST /api/auth/magic/request` in
dev/log mode, and the redirect targets after `GET /api/auth/magic/verify`) is built from
`config.clientUrl`, so without this every magic link in the e2e run pointed at the wrong origin.
Fixed by adding `CLIENT_URL=${WEB_BASE_URL}` to that `webServer` command (`playwright.config.ts`,
API `webServer` entry) — this is test environment configuration, not application code, and is
exactly the kind of thing `playwright.config.ts` is in scope to fix per this task.

**Result: one new defect found (Defect 3, below).** Everything else specified matched documented
behavior: the sign-in page's copy, method toggle and footer; `?auth=error&reason=` handling and URL
cleanup; magic-link request/verify including provisioning, role/org assignment from the access
policy, single-use enforcement, rate-limit-independent domain/inactive refusals; the full
request-access → approve (temporary password, forced change) / decline lifecycle and its Pending
count badge; the sign-in policy card's add/edit/remove-domain flow, persistence, client-side domain
validation, and the "invited users any domain" checkbox; and the `admin`+ guards on
`/api/users/access-requests` and `/api/settings/access-policy`, including the schema-level rejection
of `role: "owner"` in a policy domain.

## Defect 3 (Round 3) — A newly self-provisioned, domain-restricted user can land on (and switch to) organizations they have no access to

**Severity:** Medium (no data leaks or unauthorized writes — org-scoped API calls correctly 403 — but
the dashboard silently breaks for exactly the population this feature exists for: self-serve users
auto-provisioned with restricted `orgIds`, e.g. via the default `enelhealth.com`/`f3insights.com`
sign-in policy, or a custom domain scoped to one organization).

**Where:**
- `client/src/hooks/useOrg.ts`, `useOrgs()`, lines 14-20: the "guarantee a valid current org
  selection" effect only checks that the stored `currentOrgId` exists *somewhere* in the full org
  list (`query.data.some((o) => o.id === currentOrgId)`) and otherwise falls back to
  `query.data[0]` — the oldest-created organization — with no regard for `user.orgIds` at all.
- `client/src/components/layout/OrgSwitcher.tsx`, the dropdown's `orgs.map(...)` (~line 62): renders
  every organization from `useOrgs()` as a selectable option, again with no filtering by the
  signed-in user's `orgIds`.
- `server/src/routes/orgs.ts`, `GET /orgs` (~line 106-110): returns `repo.list()` unfiltered — by
  design, per `docs/API.md` ("Organizations... `GET` endpoints only require a signed-in user"), so
  this alone isn't the bug, but combined with the two client gaps above, the client never learns
  which orgs the current user can actually use and never restricts the switcher or the default
  selection accordingly.

**Repro steps:**
1. Sign in as the seeded owner; leave the default sign-in policy in place
   (`enelhealth.com` → `editor`, org `enel-health`; `f3insights.com` → `editor`, org `f3i`).
2. In a signed-out browser (no `currentOrgId` in `localStorage`), request a magic link for a brand
   new address on the allowed domain, e.g. `nurse@enelhealth.com`, and click it.
3. Land on Overview, now signed in as the newly auto-provisioned editor
   (`role: "editor"`, `orgIds: [<Enel Health id>]` — confirmed via `GET /api/users` as the owner).
4. Look at the org switcher in the top nav.

**Expected:** The org switcher shows (or at minimum defaults to) Enel Health — the only organization
this user has access to.

**Actual:** The org switcher lists *every* seeded organization (in this environment: `F3i`,
`Larkspur Health`, `Enel Health`, plus whatever `orgs.spec.ts`/other tests seeded earlier in the
run) and the current-org selector reads **`F3i`** — the first organization ever created, which this
user has no access to at all. The dashboard's own org-scoped queries (analytics summary, posts,
connections) are therefore all firing against an org the user can't read, so — while none of them
leak data (the server correctly 403s) — the Overview page's widgets for a brand-new self-serve user
are effectively broken on first login until they happen to notice and manually switch orgs. The
switcher itself also offers organizations the user cannot open, so switching to any of the wrong
ones just repeats the same broken state.

**Suggested fix direction (not applied — app code is out of scope for this task):** `useOrgs()`
should intersect the fetched org list with `user.orgIds` (skip the intersection when `orgIds ===
"*"`) both for the default-selection effect and for what it hands back as `orgs`, so `OrgSwitcher`
naturally only ever offers organizations the signed-in user can actually use, and a fresh session
defaults to one of them.

**Test:** `e2e/signin.spec.ts` → "nurse@enelhealth.com signs in via a magic link, is auto-provisioned
editor scoped to Enel Health, and the link is single-use". The org-switcher/current-org check uses
`expect.soft(...)` specifically so this one known-bad assertion doesn't prevent the rest of the same
test (provisioning role/orgIds via the API, and the link's single-use enforcement after signing out)
from still running and being verified — all of those other assertions pass.

## Defect 3 (Round 3): now fixed

Re-running `e2e/signin.spec.ts` unmodified at the start of Round 4 shows this now passes, `expect.soft`
and all: `server/src/routes/orgs.ts`'s `GET /orgs` handler now filters through the same `canSee(req,
org.id)` predicate the single-org `GET /orgs/:id` route already used (`repo.list().filter((org) =>
canSee(req, org.id))`), instead of returning `repo.list()` unfiltered. A domain-restricted editor's
`GET /api/orgs` now only ever returns the organization(s) in their own `orgIds`, so `useOrgs()`'s
existing (still otherwise-unchanged) "default to `query.data[0]`" logic naturally lands on — and the
switcher naturally only ever lists — an organization the user can actually use. `client/src/hooks/useOrg.ts`
and `client/src/components/layout/OrgSwitcher.tsx` were not touched and still don't filter by
`user.orgIds` themselves, but they no longer need to: the data they're given is now already scoped.
Left here for the historical record, and the pass/fail table above reflects the current, passing result;
no test changes were needed to pick this fix up.

## Round 4: X platform, full-page console, terminal, platform docs

Covered by the rewritten `e2e/console.spec.ts` (full-page `/console` route, split handle, Agent pane
commands including `/docs` and `/diagnose`, Activity log streaming/filters/Log files, viewer refusal,
and the Documentation rail's platform-docs search), the new `e2e/terminal.spec.ts` (OS terminal status,
xterm rendering, typed-echo round trip, Disconnect/Restart, viewer refusal, unauthenticated WebSocket
rejection), and the new `e2e/x.spec.ts` (X as a fifth platform: Social Profiles card, sandbox Connect
with PKCE S256, the 280-character composer limit and its X preview, a real sandbox publish producing an
`x.com` job URL, the calendar platform filter, and an Analytics series after sync).

**No new hard-failing defects.** Two things worth recording:

1. **Not a defect — a pre-existing test needed updating for the intentional 5th platform.**
   `e2e/smoke.spec.ts` → "API health and seeded organizations (authenticated)" hardcoded the expected
   connection-platform list as `["instagram", "linkedin", "tiktok", "youtube"]`. `docs/API.md` is explicit
   that this list is meant to grow ("this list drives connection counts everywhere (tests assert
   `PLATFORMS.length`, not a literal `4`)"), so with X now in `PLATFORMS`, that literal array is stale
   test data, not an app defect. Fixed by asserting against `[...PLATFORMS].sort()` (imported from
   `@socmedia/shared`) instead of a hardcoded literal, so it can't go stale again the next time a
   platform is added or removed.

2. **An environment-dependent observation on the OS terminal's `pty` status field, not confirmed as a
   cross-environment defect.** `GET /api/terminal/status`'s `pty` field (`server/src/services/terminal.ts`,
   `terminalStatus()`) is computed as `!!(await loadPty())` — i.e. whether `import("node-pty")` resolved
   at all — not whether a session can actually fork a real pseudo-terminal. `createTerminalSession()`
   separately tries `pty.spawn(...)` per session and silently falls back to a plain `child_process.spawn`
   pipe (`spawnPipeFallback()`) if that throws (e.g. no `/dev/ptmx` access), without updating anything the
   client can see. In the sandboxed shell this suite's tooling ran in, `node-pty` imports successfully
   (`status.pty === true`) but every session actually forked here fell back to the plain-pipe shell (its
   `"[suprstar] No native pty available on this host..."` banner appears in the xterm output every time),
   and the pipe fallback does not reliably echo a typed `echo suprstar-e2e` + Enter back into the rendered
   output within 15s (confirmed by hand: the command's own stdout never appeared). `docs/API.md` documents
   `pty: true` as meaning "a real pseudo-terminal is used" — on a host like this one, that's not accurate for
   any individual session, only for whether the module loaded.
   **Test:** `e2e/terminal.spec.ts` → "typing 'echo suprstar-e2e' into the xterm produces it in the
   rendered output" polls for the echoed output for 15s and only skips (with this reason attached) if it
   never arrives *and* there's independent evidence of the pipe fallback — either `status.pty === false`
   outright, or (covering exactly this mismatch) the fallback's own banner text is present in the
   rendered rows. If the output never arrives and neither signal is present, the test fails for real
   rather than skipping. This is recorded as an observation rather than a numbered, filed defect because
   it may well be specific to pty allocation being unavailable in the sandboxed shell this analysis ran
   in, rather than a guaranteed reproduction on every host that runs this suite — but the underlying code
   gap (status can say `pty: true` while a session still silently downgrades) is real and independent of
   that; a more honest `pty` status would come from actually probing pty allocation (spawn-and-kill) rather
   than only checking that the module imported.

## Notes / minor observations (not blocking, not filed as defects)

- **Login page fields aren't associated for `getByLabel` in a couple of spots that matter for testability:** the composer's Title/Caption fields (`client/src/features/studio/ComposerDrawer.tsx`) render their `<label>` via the shared `Field` component without passing `htmlFor`/`id`, so the label has no programmatic association with the input (not even implicit nesting). Not a functional bug — sighted users see the label fine — but it's an accessibility gap (screen readers won't associate the label with the field) and it forced the e2e suite to fall back to `getByPlaceholder(...)` for those two fields instead of `getByLabel(...)`.
- **Seed data changed mid-task** (an org's worth of changes landed live while this suite was being written, twice): `seedIfEmpty` now also seeds a third org ("Enel Health", pre-connected, handle `@enelhealth`) alongside "F3i" and "Larkspur Health" on a fresh database. `orgs.spec.ts` was written/adjusted to assert this pre-seeded org rather than re-creating it (which would otherwise collide on the now-reserved `enel-health` slug), and exercises `POST /api/orgs/demo` with a distinct identity (`Aster Clinic` / `aster-clinic` / `@asterclinic`) instead.
- **`smoke.spec.ts`'s original "switches organization" assertion referenced an org name ("Northstar Advisors") that doesn't exist anywhere in `server/src/db/seed.ts`** (only "F3i", "Larkspur Health", and now "Enel Health" are seeded) — this looks like it was already a stale/incorrect assertion before auth landed. Rewrote it to pick whichever seeded org isn't currently selected, dynamically, so it no longer depends on a hardcoded name.
- **The default organization ("F3i") ships with all 4 connections disconnected**, so `smoke.spec.ts`'s "analytics page shows KPIs after sync" test now explicitly switches to "Larkspur Health" (pre-connected demo data) before syncing — syncing disconnected sandbox accounts legitimately produces `{ synced: 0 }` and no KPI text, which isn't a bug, just not what that test needs.
- **The 5:00 overlong-upload rejection is exercised for real**, not skipped: a 302s fixture renders in well under a second (`ffmpeg -f lavfi -i testsrc=size=64x64:rate=8 ... -t 302 ...`, ~0.2s locally), so there was no need to fall back to only asserting the "Videos up to 5:00" hint text.
- **Concurrent development on the same working tree:** another process was actively editing `client/src` (and, briefly, seed data) while this suite ran against its own dedicated dev server on `:5174`. Because both dev servers watch the same source tree, unrelated saves were triggering HMR pushes into this suite's browser sessions and intermittently aborting in-flight requests mid-test. Disabled HMR for the e2e Vite instance only (`client/vite.config.ts`, gated on the `VITE_API_PROXY` env var that only this suite's `webServer` sets — the other dev server on `:5173` is unaffected) so each test navigation still picks up whatever's currently on disk, but an in-progress test no longer gets yanked mid-flight by someone else's save.

## Files

- `playwright.config.ts` — ports 4100/5174, single worker, `setup` project (owner login) + `chromium` project depending on it, `globalSetup` wipes `data/e2e` and renders the video and photo fixtures. Round 3 added `CLIENT_URL=${WEB_BASE_URL}` to the API `webServer` command (see "Round 3" above).
- `e2e/global-setup.ts` — also generates `e2e/fixtures/quick-photo.jpg` (a real 1080x1080 JPEG via `sharp`, resolved from the `server` workspace with `createRequire` so it works regardless of npm's hoisting) for the quick-post upload test.
- `e2e/constants.ts` — added `QUICK_PHOTO_FIXTURE`.
- `e2e/helpers.ts` — added `switchOrg(page, orgName)`, used by `quick.spec.ts` to select the pre-connected "Larkspur Health" demo org. Round 3 added `signInWithPassword(page, email, password)`, the shared "reveal the password form via 'Use a password instead', then sign in" helper used by `auth.spec.ts` and the new specs.
- `e2e/auth.setup.ts` — logs in as the bootstrap owner, saves `e2e/.auth/owner.json` (gitignored). Round 3 updated it for the redesigned sign-in page (click "Use a password instead" first).
- `e2e/auth.spec.ts`, `e2e/users.spec.ts`, `e2e/orgs.spec.ts`, `e2e/connections.spec.ts`, `e2e/video.spec.ts` — Round 1. `auth.spec.ts` updated in Round 3 for the redesigned sign-in page.
- `e2e/smoke.spec.ts` — Round 1. Round 4 updated the hardcoded 4-platform connections assertion to `[...PLATFORMS].sort()` (see "Round 4" above) so it doesn't go stale the next time a platform is added or removed.
- `e2e/quick.spec.ts`, `e2e/login.spec.ts` — Round 2. `login.spec.ts`'s heading assertions updated in Round 3 for the new copy.
- `e2e/signin.spec.ts`, `e2e/access.spec.ts` — Round 3. Unmodified in Round 4; `signin.spec.ts`'s `expect.soft` org-switcher assertion now passes for real (Defect 3 fixed — see above).
- `e2e/console.spec.ts` — Round 2, **fully rewritten in Round 4** for the Console's move from a drawer to a full page at `/console`: `rail-console`/`rail-console-mobile` navigation, Ctrl+\` open/close, `console-close`, the `console-split-handle` (keyboard-resizable, persisted `consoleSplit`), the Agent pane (`agent-scroll`, `agent-empty`, slash commands including the new `/docs` and `/diagnose`) now separate from the Activity log pane (`console-scroll`, filters, streaming, Log files), plus a Documentation-rail platform-docs search test.
- `e2e/terminal.spec.ts` — **new in Round 4**: the OS terminal tab (status line, `xterm-container`), a real typed-echo round trip through the rendered `.xterm-rows` (with a documented, evidence-based skip condition for the plain-pipe fallback — see "Round 4" above), Disconnect/Restart, a viewer's disabled explanation, and an unauthenticated WebSocket rejection (via `ws`, resolved from the `server` workspace with `createRequire`, the same trick `global-setup.ts` uses for `sharp`).
- `e2e/x.spec.ts` — **new in Round 4**: X as the fifth platform across Social Profiles, sandbox Connect (PKCE `code_challenge_method=S256`), the composer's 280-character limit and `preview-x`, a real sandbox publish job with an `x.com` URL, the calendar platform filter, and an Analytics series after sync.
- `e2e/fixtures/*.mp4`, `e2e/fixtures/quick-photo.jpg` — generated, gitignored.
- `client/vite.config.ts` — reads `VITE_API_PROXY` for the dev proxy target and disables HMR only for that instance.
