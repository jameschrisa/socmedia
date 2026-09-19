# QA Report — suprstar e2e suite

Run with `npx playwright test` from the repo root. Config: `playwright.config.ts` (root) + helpers/specs under `e2e/`.

- Total: **24 tests**, **22 passing**, **2 failing** — both failures are genuine application defects (repro'd independently of Playwright, see below), not test bugs. Verified deterministic across 5+ consecutive full-suite runs plus 3 isolated re-runs of the previously-flaky video spec.
- Environment: API on `:4100`, web on `:5174` (own Vite dev server instance, HMR disabled for that instance — see "Environment notes" below), isolated `DATA_DIR=./data/e2e` wiped by `globalSetup` on every run. Bootstrap owner: `qa@suprstar.test` / `qa-password-123` (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`), storage state cached at `e2e/.auth/owner.json` after `auth.setup.ts`.

## Pass/fail table

| # | File | Test | Result |
|---|------|------|--------|
| 1 | auth.setup.ts | authenticate as owner | ✅ pass |
| 2 | auth.spec.ts | unauthenticated visit shows the sign-in page, not the dashboard | ✅ pass |
| 3 | auth.spec.ts | wrong password shows an error and does not sign in | ✅ pass |
| 4 | auth.spec.ts | correct login lands on Overview with the org switcher | ✅ pass |
| 5 | auth.spec.ts | sign out from the user menu returns to sign-in | ❌ **fail — Defect 1** |
| 6 | auth.spec.ts | API returns 401 for /api/orgs without a session cookie | ✅ pass |
| 7 | connections.spec.ts | adding a second TikTok account lets a post queue across both | ✅ pass |
| 8 | orgs.spec.ts | Enel Health is seeded on a fresh database and shows its handle everywhere | ✅ pass |
| 9 | orgs.spec.ts | a new demo organization can be seeded from the larkspur profile with identity overrides | ✅ pass |
| 10 | smoke.spec.ts | API health and seeded organizations (authenticated) | ✅ pass |
| 11 | smoke.spec.ts | navigates between primary tabs | ✅ pass |
| 12 | smoke.spec.ts | switches organization and scopes data | ✅ pass |
| 13 | smoke.spec.ts | social profile cards flip to reveal configuration | ✅ pass |
| 14 | smoke.spec.ts | connection test returns a result in sandbox mode | ✅ pass |
| 15 | smoke.spec.ts | calendar renders the month grid with scheduled posts and a week view | ✅ pass |
| 16 | smoke.spec.ts | new post opens the composer with platform targets and time scroller | ✅ pass |
| 17 | smoke.spec.ts | AI assistant generates captions (mock or live) | ✅ pass |
| 18 | smoke.spec.ts | analytics page shows KPIs after sync | ✅ pass |
| 19 | users.spec.ts | owner invited an editor and a viewer with temporary passwords shown | ✅ pass |
| 20 | users.spec.ts | invited users appear in the Users & access table with their roles | ✅ pass |
| 21 | users.spec.ts | viewer cannot see New post and the API rejects a viewer's post creation with 403 | ✅ pass |
| 22 | users.spec.ts | editor can save a draft post from the composer but has no Users section in Settings | ❌ **fail — Defect 2** |
| 23 | video.spec.ts | shows the upload size hint and refuses a video over 5:00 client-side | ✅ pass |
| 24 | video.spec.ts | uploads a video, shows its duration, and trims a vertical clip via the scissors editor | ✅ pass |

## Defect 1 — Signing out doesn't update the UI until the page is reloaded

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

## Defect 2 — Editors (and any non-admin role) cannot create/update any post, media, job, analytics or AI resource — every write is wrongly blocked with 403

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

## Notes / minor observations (not blocking, not filed as defects)

- **Login page fields aren't associated for `getByLabel` in a couple of spots that matter for testability:** the composer's Title/Caption fields (`client/src/features/studio/ComposerDrawer.tsx`) render their `<label>` via the shared `Field` component without passing `htmlFor`/`id`, so the label has no programmatic association with the input (not even implicit nesting). Not a functional bug — sighted users see the label fine — but it's an accessibility gap (screen readers won't associate the label with the field) and it forced the e2e suite to fall back to `getByPlaceholder(...)` for those two fields instead of `getByLabel(...)`.
- **Seed data changed mid-task** (an org's worth of changes landed live while this suite was being written, twice): `seedIfEmpty` now also seeds a third org ("Enel Health", pre-connected, handle `@enelhealth`) alongside "F3i" and "Larkspur Health" on a fresh database. `orgs.spec.ts` was written/adjusted to assert this pre-seeded org rather than re-creating it (which would otherwise collide on the now-reserved `enel-health` slug), and exercises `POST /api/orgs/demo` with a distinct identity (`Aster Clinic` / `aster-clinic` / `@asterclinic`) instead.
- **`smoke.spec.ts`'s original "switches organization" assertion referenced an org name ("Northstar Advisors") that doesn't exist anywhere in `server/src/db/seed.ts`** (only "F3i", "Larkspur Health", and now "Enel Health" are seeded) — this looks like it was already a stale/incorrect assertion before auth landed. Rewrote it to pick whichever seeded org isn't currently selected, dynamically, so it no longer depends on a hardcoded name.
- **The default organization ("F3i") ships with all 4 connections disconnected**, so `smoke.spec.ts`'s "analytics page shows KPIs after sync" test now explicitly switches to "Larkspur Health" (pre-connected demo data) before syncing — syncing disconnected sandbox accounts legitimately produces `{ synced: 0 }` and no KPI text, which isn't a bug, just not what that test needs.
- **The 5:00 overlong-upload rejection is exercised for real**, not skipped: a 302s fixture renders in well under a second (`ffmpeg -f lavfi -i testsrc=size=64x64:rate=8 ... -t 302 ...`, ~0.2s locally), so there was no need to fall back to only asserting the "Videos up to 5:00" hint text.
- **Concurrent development on the same working tree:** another process was actively editing `client/src` (and, briefly, seed data) while this suite ran against its own dedicated dev server on `:5174`. Because both dev servers watch the same source tree, unrelated saves were triggering HMR pushes into this suite's browser sessions and intermittently aborting in-flight requests mid-test. Disabled HMR for the e2e Vite instance only (`client/vite.config.ts`, gated on the `VITE_API_PROXY` env var that only this suite's `webServer` sets — the other dev server on `:5173` is unaffected) so each test navigation still picks up whatever's currently on disk, but an in-progress test no longer gets yanked mid-flight by someone else's save.

## Files

- `playwright.config.ts` — ports 4100/5174, single worker, `setup` project (owner login) + `chromium` project depending on it, `globalSetup` wipes `data/e2e` and renders both video fixtures.
- `e2e/global-setup.ts`, `e2e/constants.ts`, `e2e/helpers.ts` — shared setup/fixtures/helpers.
- `e2e/auth.setup.ts` — logs in as the bootstrap owner, saves `e2e/.auth/owner.json` (gitignored).
- `e2e/auth.spec.ts`, `e2e/users.spec.ts`, `e2e/orgs.spec.ts`, `e2e/connections.spec.ts`, `e2e/video.spec.ts`, `e2e/smoke.spec.ts`.
- `e2e/fixtures/*.mp4` — generated, gitignored.
- `client/vite.config.ts` — reads `VITE_API_PROXY` for the dev proxy target and disables HMR only for that instance.
