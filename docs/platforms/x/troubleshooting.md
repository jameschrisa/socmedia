---
platform: x
topic: troubleshooting
sources:
  - https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
  - https://docs.x.com/fundamentals/developer-apps
  - https://docs.x.com/fundamentals/authentication/faq
  - https://docs.x.com/x-api/fundamentals/response-codes-and-errors
  - https://docs.x.com/x-api/fundamentals/rate-limits
  - https://docs.x.com/x-api/fundamentals/post-cap
  - https://docs.x.com/x-api/posts/creation-of-a-post
  - https://docs.x.com/x-api/media/quickstart/media-upload-chunked
  - https://docs.x.com/x-api/media/quickstart/best-practices
  - https://docs.x.com/resources/fundamentals/counting-characters
  - https://docs.x.com/changelog
fetched: 2026-09-19
---

# X — Troubleshooting checklist

## Read this first: X is not integrated in suprstar (as of 2026-09-19)

`shared/src/platforms.ts` lists only `tiktok`, `youtube`, `linkedin`, `instagram`; there is no `server/src/platforms/x.ts`. If a user asks why they cannot connect or post to X, the answer is: **X is not a supported platform in this build.** There is no X card on the Social Profiles page, no `PLATFORM_SPECS.x`, and the composer cannot target it.

The checklist below is written for the X adapter that would be built on the existing pattern (card back with Client ID / Client secret / Redirect URI / Scopes / Mode; `POST /api/connections/:id/connect` → X consent → `GET /api/connections/oauth/callback`; manual "Refresh token" button; "Test connection" = `GET /2/users/me`). Where a check depends on adapter behaviour that does not exist yet, it is phrased as a requirement for the implementer.

## Standard suprstar checks (apply to every symptom)

1. **Mode** on the card back: `Sandbox` never calls X — tokens, profile and publish IDs are simulated by `server/src/platforms/sandbox.ts`. If the user expects a real post, mode must be `Live`. If they only want to demo, `Sandbox` avoids spending credits.
2. **Credentials**: Client ID / Client secret must be the **OAuth 2.0 Client ID and Client Secret** from the app's user-authentication settings in console.x.com — not the API Key / API Key Secret (OAuth 1.0a) and not the Bearer Token. The secret is shown once ("Save credentials immediately—they're only shown once."); regenerate if lost, then re-enter.
3. **Redirect URI**: must equal a registered Callback URI byte-for-byte ("URLs must match exactly (including trailing slashes)"), be `https://` in production, and use `http://127.0.0.1` not `localhost` locally.
4. **Scopes**: all five checked — `tweet.read`, `tweet.write`, `users.read`, `media.write`, `offline.access`. Scope changes only take effect after **reconnecting**; the stored token keeps the old scope set.
5. **Token status**: X access tokens last 2 hours. If `tokenExpiresAt` is in the past, press "Refresh token"; if that fails, "Disconnect" then "Connect" again.
6. **Test connection**: runs `GET /2/users/me`. Read the `message` on the result — it is the X `detail`/`title` string (see `errors.md`).
7. **Credits**: the developer account behind the Client ID must have a positive credit balance (pay-per-use since 2026-02-06) or an active legacy Basic/Pro plan. "API requests will fail until you purchase more credits."

## Symptom: "Connect" button loops back / lands on /connections?error=...

Sources: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code , https://docs.x.com/fundamentals/developer-apps

Likely causes:
- Redirect URI mismatch (trailing slash, `http` vs `https`, `localhost` vs `127.0.0.1`, port). X shows an error page and never redirects, or redirects with an error.
- Missing PKCE: X requires `code_challenge` + `code_challenge_method`; suprstar's generic flow has no PKCE, so an X adapter that reuses `buildAuthorizeUrl` verbatim from another adapter will fail at the consent screen.
- `code_verifier` lost between `/connect` and the callback (server restarted; verifier not persisted per `state`) → token exchange fails with `invalid_request` "Value passed for the authorization code was invalid, or expired." (unverified verbatim).
- Authorization code expired: "30 seconds once the App owner receives an approved auth_code". Double-submitted callback (browser refresh) reuses the code.
- App type is Public (Native/SPA) while suprstar sends a Basic header → `unauthorized_client`/`invalid_client` (unverified verbatim).
- Wrong credential type on the card (API Key instead of Client ID).
- User cancelled consent → `error=access_denied` (standard OAuth, unverified on docs).

What to check in suprstar:
- The `error=` query string on the redirect (the callback forwards the exception message).
- Card back Redirect URI vs the console Callback URI list (max 10 per app).
- Card back Client ID looks like an OAuth 2.0 client id (base64-ish string ending in `:1:ci`, as in the docs example `M1M5R3BMVy13QmpScXkzTUt5OE46MTpjaQ`), not a 25-char API key.
- Adapter persists the PKCE verifier keyed by `state` and reads it in `exchangeCode`.

Fix: correct URI/credentials/app type; retry connect once (fresh code, fresh verifier).

## Symptom: connection test fails

Sources: https://docs.x.com/x-api/users/user-lookup-me , https://docs.x.com/x-api/fundamentals/response-codes-and-errors

| Test message contains | Cause | Fix |
|---|---|---|
| `Unauthorized` (401) | access token > 2 h old and not refreshed; user revoked the app in X settings; app suspended | Refresh token; if refresh returns `invalid_grant` (unverified verbatim), reconnect |
| `client-forbidden` / `not-authorized-for-resource` (403) | app permission "Read only" or missing `users.read`/`tweet.read`; legacy app not attached to a Project | fix app settings, reconnect |
| `Rate limit exceeded` / 429 | > 75 `GET /2/users/me` calls in 15 min | wait until `x-rate-limit-reset` |
| `usage-capped` / 402 | credits exhausted | top up at console.x.com |
| Network error / timeout | outbound HTTPS to `api.x.com` blocked | check server egress |
| "Credentials present: false" | Client ID or secret empty | fill card back |

## Symptom: publish fails immediately

Sources: https://docs.x.com/x-api/posts/creation-of-a-post , https://docs.x.com/resources/fundamentals/counting-characters , https://docs.x.com/x-api/media/quickstart/best-practices

| Job error text | Cause | Fix |
|---|---|---|
| `Unauthorized` (401) | token expired — suprstar does **not** auto-refresh before publishing; a 2-hour X token will be dead by the time a scheduled post fires unless the adapter refreshes on demand | Press "Refresh token" and republish; implementer: refresh inside `publish()` when `tokenExpiresAt` is near |
| 403 `client-forbidden` / "oauth1 app permissions" | app is Read-only, or token predates the permission change | set "Read and write", reconnect |
| 403 `not-authorized-for-resource` on media | `media.write` not granted | add scope on card back, reconnect |
| 403 "duplicate content" (unverified verbatim) | identical text posted recently | see "duplicate content rejected" |
| 400 `invalid-request` (text) | > 280 weighted chars (emoji = 2, any URL = 23) | trim caption |
| 400 `invalid-request` (`media_ids`) | > 4 ids; video mixed with images; media id expired (24 h); wrong `media_category` | fix media set; re-upload with `tweet_image`/`tweet_video` |
| 403 quote/reply not allowed | Quote posts Enterprise-only (2026-04-16); programmatic replies only when "summoned" (2026-02-23) | remove quote/reply fields |
| 429 | 100 posts / 15 min per user or 10,000 / 24 h per app | wait for reset |
| 402 / `usage-capped` | credits exhausted | buy credits |
| "X posts require ..." (adapter validation) | no text and no media | add caption or media |

Also confirm `Mode` is `Live`; in `Sandbox` the publish always "succeeds" with a fake `sb_...` id and a fake URL.

## Symptom: post stuck processing

Sources: https://docs.x.com/x-api/media/quickstart/media-upload-chunked , https://docs.x.com/x-api/media/media-upload-status

- X only has processing state for **media** (video/GIF), not for the post. `POST /2/tweets` is synchronous.
- Video flow: INIT → APPEND (≤ 5 MB chunks) → FINALIZE → poll `GET /2/media/upload?command=STATUS&media_id=...` until `processing_info.state` is `succeeded`; honour `check_after_secs`.
- Causes of a hang: adapter not polling STATUS and calling `POST /2/tweets` while `in_progress` (post creation fails, job may loop); processing `failed` (bad codec: needs H.264 High + AAC LC, YUV 4:2:0, progressive, ≤ 60 fps, aspect 1:3–3:1); very long video (default cap 20 min / 8 GB; Premium 125 min / 16 GB); the user's 2-hour token expiring during a long upload.
- What to check: the job's error text for `processing_info`; the media's duration/size vs the posting user's Premium status ("Specification limits follow the authenticated user (X Premium / verified status), not your developer API plan."); server logs for the last STATUS response.
- Fix: re-encode per `publishing.md`; implementer: cap polling at a few minutes and fail with the `processing_info.error.message`.

## Symptom: post published but not visible

Sources: https://docs.x.com/x-api/posts/creation-of-a-post

- Check the job's `externalId` — a real X post id is a numeric snowflake (e.g. `1234567890123456789`); `sb_...` means Sandbox mode.
- URL should be `https://x.com/<username>/status/<id>`; an adapter that builds it from a stale handle will 404 even though the post exists. Fetch `GET /2/tweets/:id` to confirm.
- The account may be protected (posts visible to followers only) — no API flag; check in X settings.
- `nullcast: true` hides the post from the public timeline (Ads use) — an adapter must not set it.
- `for_super_followers_only: true` or `community_id` restrict visibility to subscribers / a Community.
- Deleted by X for policy reasons, or the account is limited — `GET /2/tweets/:id` returns `resource-not-found` in `errors[]`.
- `reply_settings` does not hide the post, only limits who can reply.

## Symptom: metrics empty

Sources: https://docs.x.com/x-api/posts/post-lookup-by-post-ids , https://docs.x.com/x-api/users/user-lookup-me

- There is no time-series analytics endpoint; the adapter must snapshot `public_metrics` itself. If `fetchMetrics` is a stub returning `[]` (as the other four live adapters currently do), the dashboard is empty by design in Live mode; Sandbox mode generates seeded demo metrics.
- `non_public_metrics` / `organic_metrics` return 403 unless the token's user owns the post and user-context auth is used; request only `public_metrics` when in doubt.
- Each returned post is a billed read ($0.005 / $0.001 owned); `usage-capped` after 3 M reads / month stops metrics silently if the adapter swallows errors.
- 200 responses can still contain `errors[]` for deleted ids — check them.
- Rate limits: `GET /2/tweets` 5,000 / 15 min per user; `GET /2/users/me` 75 / 15 min.

## Symptom: token expired every day (or every two hours)

Sources: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code , https://docs.x.com/fundamentals/authentication/faq

- Expected: "the access token ... will only stay valid for two hours unless you've used the `offline.access` scope." With `offline.access` a refresh token is issued; without it, the connection must be re-authorized every 2 hours.
- Check the card back: `offline.access` must be ticked **and** the connection must have been made after ticking it. Look at the token's `scope` value from the exchange response (adapter should store it in `credentials.scopes`).
- Refresh returns a **new** refresh token each time (rotation; unverified on docs but standard). If the adapter stores only `access_token` on refresh (the LinkedIn/YouTube adapters' pattern), the second refresh fails with `invalid_grant` — implementer must copy the TikTok pattern and persist `refresh_token`.
- Multiple suprstar connections sharing one X user + one Client ID and each refreshing independently will invalidate each other's refresh tokens (unverified; rotation consequence). One X account per connection.
- User revoked the app in X settings → "prompt the user to re-authorize the application."
- suprstar has no scheduled refresh; only the card-back button and `POST /:id/refresh`. Until on-demand refresh exists in the adapter, "expired every day" is expected behaviour.

## Symptom: duplicate content rejected

Sources: https://docs.x.com/x-api/posts/creation-of-a-post (behaviour); error string unverified on docs.x.com

- X refuses a post whose text matches a recent post by the same account: 403 "You are not allowed to create a Tweet with duplicate content." (legacy code 187).
- Typical suprstar triggers: republishing a failed job with an unchanged caption; posting the same caption to two X connections that are actually the same X account; a scheduled post that already went out (job retried after a timeout even though X created the post — check `GET /2/users/:id/tweets` before retrying).
- Fix: edit the caption (even a different emoji or hashtag counts), or attach different media; wait some hours (window undocumented; unverified).

## Symptom: rate limited

Sources: https://docs.x.com/x-api/fundamentals/rate-limits , https://docs.x.com/x-api/fundamentals/post-cap

- 429 with `type` `rate-limit-exceeded` → per-endpoint window. Headers `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset` (epoch seconds). Wait until reset; docs recommend "exponential backoff, cache responses, and distribute requests across the window."
- 429 with `type` `usage-capped` (or 402) → monthly cap / credits, not time-based; retrying will not help. "API requests will fail until you purchase more credits. Set up balance alerts to avoid interruption."
- Limits that suprstar can hit: `POST /2/tweets` 100 / 15 min per user, 10,000 / 24 h per app; media upload 500 / 15 min per user; `GET /2/users/me` 75 / 15 min (repeated Test connection clicks); `GET /2/tweets` 5,000 / 15 min.
- What to check: how many connections share one Client ID (app-level 24 h limits are shared across all users of the app); whether a bulk schedule fires many posts in the same 15-minute window; credit balance in console.x.com.
- "Rate limits and billing are separate" — being under the rate limit does not mean the request will be paid for.

## Symptom: everything works in Sandbox but not Live

- Sandbox never contacts X. Switching to Live requires: real OAuth 2.0 Client ID/secret, a registered Callback URI equal to the card's Redirect URI, app permission "Read and write", app type "Web App", scopes including `media.write` and `offline.access`, a credit balance, and a fresh Connect (sandbox tokens `sb_access_...` are not valid on X).

## Date-sensitive items in this file

- Pay-per-use model and per-request prices (launched 2026-02-06, revised 2026-04-16).
- Quote-post and reply restrictions on self-serve plans (2026).
- Media duration/size limits (changelog 2026-09-01).
- Rate-limit table values (rate-limits page, 2026-09-19).
