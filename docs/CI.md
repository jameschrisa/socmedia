# Continuous integration and gated deploys

`.github/workflows/ci.yml` runs on every push to `main`, every pull request, and on demand.

| Job | What it does |
| --- | --- |
| `test` | `npm ci`, `npm run typecheck`, `npm test` (shared, server, client), `npm run build` |
| `e2e` | Installs Chromium and runs the Playwright suite; uploads the report and traces when it fails |
| `deploy` | Only on a push to `main`, only after both jobs pass; triggers each host that has a deploy hook |

Actions minutes are free on this repository because it is public.

## Step 1: install the workflow (done)

The workflow is installed at `.github/workflows/ci.yml`. It was parked at `docs/ci-workflow.yml`
for a while because the stored GitHub token lacked `workflow` scope, and a push containing a
workflow file is rejected whole, which blocked every other change with it. The token now carries
that scope, so the file lives in its proper place and the next push shows a green or red check
next to the commit.

If a future token loses the scope, the symptom is a push rejected with "refusing to allow a
Personal Access Token to create or update workflow". Fix it at GitHub → Settings → Developer
settings → Personal access tokens: for a classic token tick `workflow`, for a fine-grained token
set the repository permission **Workflows** to *Read and write*. Then store it again:

```
printf "protocol=https\nhost=github.com\n" | git credential-osxkeychain erase
printf "protocol=https\nhost=github.com\nusername=jameschrisa\npassword=<TOKEN>\n\n" | git credential-osxkeychain store
```

## Step 2: stop the hosts from deploying on their own

Until this step, both hosts still deploy the moment a commit lands, so a red build reaches
production anyway. CI only tells you afterwards.

1. **Create the deploy hooks.**
   - Render → the `suprstar-api` service → Settings → Deploy Hook → copy the URL.
   - Vercel → the `socmedia` project → Settings → Git → Deploy Hooks → create one for `main`
     and copy the URL.
2. **Add them as repository secrets.** GitHub → the repository → Settings → Secrets and
   variables → Actions → New repository secret:
   - `RENDER_DEPLOY_HOOK`
   - `VERCEL_DEPLOY_HOOK`
3. **Turn off automatic deploys.**
   - Render → the service → Settings → Auto-Deploy → off.
   - Vercel → the project → Settings → Git → turn off automatic deployments for `main`, or set
     the Ignored Build Step to `exit 0` so only the hook builds.

A deploy hook can only start a deploy, which is why the workflow uses one instead of an API key.

## Step 3 (optional): require the check before merging

If you move to pull requests rather than pushing straight to `main`, protect the branch so a red
build cannot merge: GitHub → Settings → Branches (or Rules) → add a rule for `main` → require
status checks to pass → select **Typecheck, unit tests, build** and **End-to-end**.

Skip this while you are still pushing directly to `main`; the deploy gate in step 2 already
prevents a broken commit from reaching either host.

## Running the same checks locally

```bash
npm run typecheck
npm test
npm run build
npx playwright test
```

The end-to-end suite starts its own API on port 4100 and web server on port 5174, so it does not
disturb a development server on 4000 and 5173.
