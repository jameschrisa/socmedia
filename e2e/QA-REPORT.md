# QA Report — suprstar e2e suite

Run with `npx playwright test` from the repo root. Config: `playwright.config.ts` (root) + helpers/specs under `e2e/`.

- Total: **39 tests**, **39 passing**, **0 failing**. Verified deterministic across 3+ consecutive full-suite runs in Round 2, on top of the determinism already established in Round 1.
- **Both Round 1 defects are now fixed in the application code** and their tests pass unmodified — see "Round 1 defects: now fixed" below. Round 2 (console, agent, quick post, sign-in video) found no new defects; see the notes at the end of that section for two non-blocking testability observations.
- Environment: API on `:4100`, web on `:5174` (own Vite dev server instance, HMR disabled for that instance — see "Environment notes" below), isolated `DATA_DIR=./data/e2e` wiped by `globalSetup` on every run. Bootstrap owner: `qa@suprstar.test` / `qa-password-123` (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`), storage state cached at `e2e/.auth/owner.json` after `auth.setup.ts`.

## Pass/fail table

| # | File | Test | Result |
|---|------|------|--------|
| 1 | auth.setup.ts | authenticate as owner | ✅ pass |
| 2 | auth.spec.ts | unauthenticated visit shows the sign-in page, not the dashboard | ✅ pass |
| 3 | auth.spec.ts | wrong password shows an error and does not sign in | ✅ pass |
| 4 | auth.spec.ts | correct login lands on Overview with the org switcher | ✅ pass |
| 5 | auth.spec.ts | sign out from the user menu returns to sign-in | ✅ pass (was ❌ Defect 1 in Round 1 — now fixed) |
| 6 | auth.spec.ts | API returns 401 for /api/orgs without a session cookie | ✅ pass |
| 7 | connections.spec.ts | adding a second TikTok account lets a post queue across both | ✅ pass |
| 8 | console.spec.ts | rail-console opens the Console drawer, Ctrl+\` toggles it, and its height persists across a reload | ✅ pass |
| 9 | console.spec.ts | shows recent server activity and streams new lines in without a reload | ✅ pass |
| 10 | console.spec.ts | filters narrow the visible lines by source and by text | ✅ pass |
| 11 | console.spec.ts | slash commands: /status, /help, /whoami, an offline-mock reply, /clear and history recall | ✅ pass |
| 12 | console.spec.ts | owner sees a Log files tab listing rotated app logs with viewable content | ✅ pass |
| 13 | console.spec.ts | a viewer has no Log files tab, is 403'd from the files API, and gets a refusal (not a publish) from a write slash command | ✅ pass |
| 14 | login.spec.ts | a signed-out visit renders the looping background video with a poster and an mp4 source | ✅ pass |
| 15 | login.spec.ts | prefers-reduced-motion renders the poster image instead of a video | ✅ pass |
| 16 | login.spec.ts | both background media files are served as the right content type | ✅ pass |
| 17 | orgs.spec.ts | Enel Health is seeded on a fresh database and shows its handle everywhere | ✅ pass |
| 18 | orgs.spec.ts | a new demo organization can be seeded from the larkspur profile with identity overrides | ✅ pass |
| 19 | quick.spec.ts | Settings -> Quick post from your phone: creating a link shows the reveal dialog and lists the new link | ✅ pass |
| 20 | quick.spec.ts | the public phone page shows the org and an Instagram chip, and refuses to post without a photo | ✅ pass |
| 21 | quick.spec.ts | uploading a photo and a caption posts immediately and shows a live link | ✅ pass |
| 22 | quick.spec.ts | multipart edge cases: missing caption needs a caption, a transcript is used as-is, unknown tokens 404 | ✅ pass |
| 23 | quick.spec.ts | a deactivated token shows the invalid-link message on the phone page | ✅ pass |
| 24 | quick.spec.ts | revoking the link removes it from the table | ✅ pass |
| 25 | smoke.spec.ts | API health and seeded organizations (authenticated) | ✅ pass |
| 26 | smoke.spec.ts | navigates between primary tabs | ✅ pass |
| 27 | smoke.spec.ts | switches organization and scopes data | ✅ pass |
| 28 | smoke.spec.ts | social profile cards flip to reveal configuration | ✅ pass |
| 29 | smoke.spec.ts | connection test returns a result in sandbox mode | ✅ pass |
| 30 | smoke.spec.ts | calendar renders the month grid with scheduled posts and a week view | ✅ pass |
| 31 | smoke.spec.ts | new post opens the composer with platform targets and time scroller | ✅ pass |
| 32 | smoke.spec.ts | AI assistant generates captions (mock or live) | ✅ pass |
| 33 | smoke.spec.ts | analytics page shows KPIs after sync | ✅ pass |
| 34 | users.spec.ts | owner invited an editor and a viewer with temporary passwords shown | ✅ pass |
| 35 | users.spec.ts | invited users appear in the Users & access table with their roles | ✅ pass |
| 36 | users.spec.ts | viewer cannot see New post and the API rejects a viewer's post creation with 403 | ✅ pass |
| 37 | users.spec.ts | editor can save a draft post from the composer but has no Users section in Settings | ✅ pass (was ❌ Defect 2 in Round 1 — now fixed) |
| 38 | video.spec.ts | shows the upload size hint and refuses a video over 5:00 client-side | ✅ pass |
| 39 | video.spec.ts | uploads a video, shows its duration, and trims a vertical clip via the scissors editor | ✅ pass |

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

## Notes / minor observations (not blocking, not filed as defects)

- **Login page fields aren't associated for `getByLabel` in a couple of spots that matter for testability:** the composer's Title/Caption fields (`client/src/features/studio/ComposerDrawer.tsx`) render their `<label>` via the shared `Field` component without passing `htmlFor`/`id`, so the label has no programmatic association with the input (not even implicit nesting). Not a functional bug — sighted users see the label fine — but it's an accessibility gap (screen readers won't associate the label with the field) and it forced the e2e suite to fall back to `getByPlaceholder(...)` for those two fields instead of `getByLabel(...)`.
- **Seed data changed mid-task** (an org's worth of changes landed live while this suite was being written, twice): `seedIfEmpty` now also seeds a third org ("Enel Health", pre-connected, handle `@enelhealth`) alongside "F3i" and "Larkspur Health" on a fresh database. `orgs.spec.ts` was written/adjusted to assert this pre-seeded org rather than re-creating it (which would otherwise collide on the now-reserved `enel-health` slug), and exercises `POST /api/orgs/demo` with a distinct identity (`Aster Clinic` / `aster-clinic` / `@asterclinic`) instead.
- **`smoke.spec.ts`'s original "switches organization" assertion referenced an org name ("Northstar Advisors") that doesn't exist anywhere in `server/src/db/seed.ts`** (only "F3i", "Larkspur Health", and now "Enel Health" are seeded) — this looks like it was already a stale/incorrect assertion before auth landed. Rewrote it to pick whichever seeded org isn't currently selected, dynamically, so it no longer depends on a hardcoded name.
- **The default organization ("F3i") ships with all 4 connections disconnected**, so `smoke.spec.ts`'s "analytics page shows KPIs after sync" test now explicitly switches to "Larkspur Health" (pre-connected demo data) before syncing — syncing disconnected sandbox accounts legitimately produces `{ synced: 0 }` and no KPI text, which isn't a bug, just not what that test needs.
- **The 5:00 overlong-upload rejection is exercised for real**, not skipped: a 302s fixture renders in well under a second (`ffmpeg -f lavfi -i testsrc=size=64x64:rate=8 ... -t 302 ...`, ~0.2s locally), so there was no need to fall back to only asserting the "Videos up to 5:00" hint text.
- **Concurrent development on the same working tree:** another process was actively editing `client/src` (and, briefly, seed data) while this suite ran against its own dedicated dev server on `:5174`. Because both dev servers watch the same source tree, unrelated saves were triggering HMR pushes into this suite's browser sessions and intermittently aborting in-flight requests mid-test. Disabled HMR for the e2e Vite instance only (`client/vite.config.ts`, gated on the `VITE_API_PROXY` env var that only this suite's `webServer` sets — the other dev server on `:5173` is unaffected) so each test navigation still picks up whatever's currently on disk, but an in-progress test no longer gets yanked mid-flight by someone else's save.

## Files

- `playwright.config.ts` — ports 4100/5174, single worker, `setup` project (owner login) + `chromium` project depending on it, `globalSetup` wipes `data/e2e` and renders the video and photo fixtures.
- `e2e/global-setup.ts` — also generates `e2e/fixtures/quick-photo.jpg` (a real 1080x1080 JPEG via `sharp`, resolved from the `server` workspace with `createRequire` so it works regardless of npm's hoisting) for the quick-post upload test.
- `e2e/constants.ts` — added `QUICK_PHOTO_FIXTURE`.
- `e2e/helpers.ts` — added `switchOrg(page, orgName)`, used by `quick.spec.ts` to select the pre-connected "Larkspur Health" demo org.
- `e2e/auth.setup.ts` — logs in as the bootstrap owner, saves `e2e/.auth/owner.json` (gitignored).
- `e2e/auth.spec.ts`, `e2e/users.spec.ts`, `e2e/orgs.spec.ts`, `e2e/connections.spec.ts`, `e2e/video.spec.ts`, `e2e/smoke.spec.ts` — Round 1.
- `e2e/console.spec.ts`, `e2e/quick.spec.ts`, `e2e/login.spec.ts` — Round 2 (this pass).
- `e2e/fixtures/*.mp4`, `e2e/fixtures/quick-photo.jpg` — generated, gitignored.
- `client/vite.config.ts` — reads `VITE_API_PROXY` for the dev proxy target and disables HMR only for that instance.
