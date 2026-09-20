---
platform: x
topic: overview
sources:
  - https://docs.x.com/x-api/getting-started/about-x-api
  - https://docs.x.com/x-api/getting-started/pricing
  - https://docs.x.com/x-api/fundamentals/post-cap
  - https://docs.x.com/x-api/getting-started/getting-access
  - https://docs.x.com/fundamentals/developer-apps
  - https://docs.x.com/x-api/fundamentals/rate-limits
  - https://docs.x.com/changelog
  - https://docs.x.com/x-api/media/introduction
  - https://developer.x.com/en/support/x-api/v2
fetched: 2026-09-19
---

# X (Twitter) — API overview for suprstar

## Status in suprstar: NOT integrated

As of 2026-09-19 suprstar has **no X adapter**:

- `shared/src/platforms.ts` declares `PLATFORMS = ["tiktok", "youtube", "linkedin", "instagram"]`; there is no `x` entry in `PLATFORM_SPECS`.
- `server/src/platforms/` contains `tiktok.ts`, `youtube.ts`, `linkedin.ts`, `instagram.ts`, `sandbox.ts` — no `x.ts`.
- The Social Profiles UI (`client/src/features/connections/`) therefore never shows an X card.

Everything in `docs/platforms/x/` is a reference for (a) the engineer who adds the adapter and (b) the in-app agent once X connections exist. If a user reports an "X" problem today, the correct answer is that X is not yet a supported platform in this build.

### How X would map onto the existing adapter pattern

The `PlatformAdapter` interface in `server/src/platforms/types.ts` requires: `buildAuthorizeUrl`, `exchangeCode`, `refreshToken`, `fetchProfile`, `testConnection`, `publish`, `fetchMetrics`. For X these would be:

| Adapter method | X API v2 call |
|---|---|
| `buildAuthorizeUrl` | `https://x.com/i/oauth2/authorize` with PKCE (`code_challenge`, `code_challenge_method=S256`) — see `oauth.md` |
| `exchangeCode` | `POST https://api.x.com/2/oauth2/token` (`grant_type=authorization_code`, `code_verifier`) |
| `refreshToken` | `POST https://api.x.com/2/oauth2/token` (`grant_type=refresh_token`) — requires `offline.access` scope |
| `fetchProfile` / `testConnection` | `GET https://api.x.com/2/users/me?user.fields=public_metrics,profile_image_url,username,name,verified` |
| `publish` | `POST https://api.x.com/2/media/upload` (images) or the chunked `/2/media/upload/initialize|append|finalize` flow (video), then `POST https://api.x.com/2/tweets` |
| `fetchMetrics` | `GET https://api.x.com/2/tweets?ids=...&tweet.fields=public_metrics,non_public_metrics,organic_metrics` and `GET /2/users/me?user.fields=public_metrics` |

One structural gap: suprstar's existing OAuth flow has **no PKCE support**. `state` is `base64url(JSON.stringify({ connectionId }))` (see `encodeState`/`decodeState` in `server/src/routes/connections.ts`) and the callback `GET /api/connections/oauth/callback` only reads `code` and `state`. X **requires** PKCE on the authorization-code flow, so an X adapter needs somewhere to persist `code_verifier` between `/connect` and the callback (keyed by `state` or stored on the connection record). Do not put the verifier in `state` itself.

## What the X API v2 can do (relevant subset)

Source: https://docs.x.com/x-api/getting-started/about-x-api

- Create and delete Posts (`POST /2/tweets`, `DELETE /2/tweets/:id`), including replies, quotes (Enterprise only as of 2026-04), polls, community posts, and edits.
- Upload media (images, GIFs, video, subtitles) via the v2 media endpoints (`/2/media/upload`, `/2/media/upload/initialize`, `/append`, `/finalize`, `GET /2/media/upload?command=STATUS`, `POST /2/media/metadata`).
- Look up the authenticated user (`GET /2/users/me`) and Posts with `public_metrics`, `non_public_metrics`, `organic_metrics`, `promoted_metrics`.
- The docs describe v2 as: "Pay-per-usage pricing", "Modern JSON response format", "Flexible fields and expansions", "Advanced features: annotations, conversation tracking, edit history".

Not relevant to suprstar and not covered here: streams, DMs, lists, bookmarks, Spaces, Community Notes, Ads API.

## Access model, pricing and tiers (date-sensitive)

Sources: https://docs.x.com/x-api/getting-started/pricing , https://docs.x.com/x-api/fundamentals/post-cap , https://docs.x.com/changelog

### Current model: pay-per-usage credits (since 2026-02-06)

The changelog records:

- **2025-10-20**: "Limited closed pilot" of a usage-based model. Initial rates: $0.005/Post Read, $0.01/User Read, $0.01/DM Event Read, $0.01/Content Create.
- **2026-02-06**: "X API Pay-Per-Use pricing" launched as a "flexible credit-based model" replacing fixed subscription tiers; new developer console at **console.x.com**; Python/TypeScript SDKs; "up to 20% back in xAI/Grok API credits".
- **2026-04-16**: "Owned Reads" introduced at $0.001 per resource; `POST /2/tweets` changed to "$0.015 per post"; Posts containing a URL became "$0.20 per Post"; Following, Likes and Quote-Posts "removed from all self-serve tiers".

The pricing page states: "The X API uses **pay-per-usage** pricing. No subscriptions—pay only for what you use." Credits are "deducted per request".

Per-request prices quoted on the pricing page (2026-09-19; re-verify before relying on them):

| Operation | Price |
|---|---|
| Post read (per resource) | $0.005 |
| User read (per resource) | $0.010 |
| Post creation (standard) | $0.015 per request |
| Post creation containing a URL | $0.200 per request |
| Post creation, "summoned" reply | $0.010 per request |
| "Owned Reads" (your own posts/followers/etc.) | $0.001 per resource |

Deduplication: "Same resource requested twice in 24 hours is only charged once." The billing page phrases it as: "If the same post is returned from multiple queries within a day, it only counts once for billing."

Caps: "Pay-per-usage plans are subject to a monthly cap of 3 million Post reads." Above that, Enterprise is required.

When credits are exhausted: "API requests will fail until you purchase more credits. Set up balance alerts to avoid interruption." The docs do **not** state the HTTP status returned in this case (unverified; treat a 402 or a 429 with `type` `.../usage-capped` as the likely signals — see `errors.md`).

Rate limits and billing are independent: "Rate limits and billing are separate".

### Legacy subscription tiers (Free / Basic / Pro / Enterprise)

These are the pre-2026 tiers. `developer.x.com` returned HTTP 402 to direct fetches on 2026-09-19, so the numbers below come from the search-index excerpt of https://developer.x.com/en/support/x-api/v2 and should be treated as **legacy / unverified for new sign-ups**:

| Tier | Monthly Post cap (writes) | Notes from the legacy support page |
|---|---|---|
| Free | "up to 500 Posts and 100 Reads per month" | write-focused; docs.x.com search snippets say "Recently active Legacy Free tier users receive a one-time $10 voucher" under pay-per-use |
| Basic | "up to 10,000 Posts per month" | "$200 per month or $175 per month with annual subscription"; "2 App environments" |
| Pro | "1,000,000 Posts per month" | "$5K per month"; "3 app environments" |
| Enterprise | "50,000,000 Posts per month and higher" | "Starting at $42K per month" |

The docs.x.com search index also states (2026): "Basic and Pro plans remain available, and existing subscribers can opt in to Pay-Per-Use" and "Public Utility Apps continue to receive free scaled access." The commonly cited legacy Free-tier figure of **17 `POST /2/tweets` requests per 24 hours per user** and the "1,500 posts/month" figure are **not present on docs.x.com** as of this pull — unverified; do not quote them to users as current.

Practical implication for suprstar: an X connection will only work if the developer account behind the Client ID has a positive credit balance (or an active legacy Basic/Pro subscription). A brand-new account with zero credits will see requests fail.

## Developer portal setup (what the Client ID / Secret are)

Sources: https://docs.x.com/x-api/getting-started/getting-access , https://docs.x.com/fundamentals/developer-apps

Steps quoted from "getting access":

1. "Visit console.x.com and sign in with your X account"; "Review and accept the Developer Agreement and Policy"; "Provide basic information about how you'll use the API".
2. "From the Developer Console dashboard, create a new app"; "Provide a name, description, and use case for your app"; "The console will generate your API keys and tokens".
3. Save credentials — four credential types are issued: API Key & Secret (OAuth 1.0a), Bearer Token (app-only), Access Token & Secret (OAuth 1.0a, the owner's own account), and **Client ID & Client Secret (OAuth 2.0)**. "Save credentials immediately—they're only shown once."

For suprstar's card back the **Client ID** and **Client secret** fields must hold the **OAuth 2.0 Client ID / Client Secret**, not the API Key / API Key Secret (those are OAuth 1.0a consumer keys and will fail at `POST /2/oauth2/token` with `invalid_client`).

App types (OAuth 2.0), quoted from the developer-apps page:

- "Web App" (Confidential): "Server-side applications that can securely store secrets" — **this is the type to pick for suprstar** (server-side token exchange with a client secret).
- "Automated App/Bot" (Confidential): "Bots and automated services running on servers".
- "Native App" (Public) and "Single Page App" (Public): PKCE only, no secret.

App permissions (set under the app's user-authentication settings):

- "Read only": "View posts, users, and public data"
- "Read and write": posting, following, liking — **required for `POST /2/tweets` and media upload**
- "Read, write, and DMs"
- "Changing permissions requires users to re-authorize your app to get new tokens with the updated scope."

Callback URL rules:

- "URLs must match exactly (including trailing slashes)"
- "Use `https://` in production"
- "For local development, use `http://127.0.0.1` (not `localhost`)"
- "Maximum of **10 callback URLs** per app"

suprstar's suggested redirect is `${window.location.origin}/api/connections/oauth/callback`. On a dev machine that resolves to `http://localhost:4000/...`, which X will reject; register and use `http://127.0.0.1:4000/api/connections/oauth/callback` instead and open the app via 127.0.0.1 so the suggested value matches.

The legacy requirement that a v2 App be attached to a **Project** (error `client-not-enrolled`, "When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project") is not described on the current docs.x.com pages fetched; the new console.x.com flow creates the app directly. Marked **unverified** for 2026; keep the error mapping in `errors.md` because older apps can still hit it.

## Sandbox vs production

X provides **no sandbox environment** for the v2 Posts or Media endpoints (no page on docs.x.com describes one; unverified only in the sense that absence cannot be proven). Every live call spends credits and, for `POST /2/tweets`, creates a real public Post. suprstar's own **Sandbox** mode (`mode: "sandbox"` on the connection, implemented by `server/src/platforms/sandbox.ts`) is the only safe test path: it fabricates tokens, a profile and publish IDs without touching X. An X adapter must be wrapped with `sandboxWrap` like the other four.

## Rate limits (headline numbers)

Source: https://docs.x.com/x-api/fundamentals/rate-limits (2026-09-19)

| Endpoint | Per App | Per User |
|---|---|---|
| `POST /2/tweets` | 10,000 / 24 h | 100 / 15 min |
| `DELETE /2/tweets/:id` | — | 50 / 15 min |
| `GET /2/tweets` | 3,500 / 15 min | 5,000 / 15 min |
| `GET /2/tweets/:id` | 450 / 15 min | 900 / 15 min |
| `GET /2/users/me` | — | 75 / 15 min |
| `GET /2/users/:id/tweets` | 10,000 / 15 min | 900 / 15 min |
| `POST /2/media/upload` | 50,000 / 24 h | 500 / 15 min |
| `POST /2/media/metadata` | 50,000 / 24 h | 500 / 15 min |

The page does not differentiate these by tier; it notes "Enterprise customers have custom rate limits". Headers and 429 handling are in `errors.md`.

## Quotas that matter for a publisher

- **Credits** (money) — every `POST /2/tweets` costs $0.015 ($0.20 if the text contains a URL). A connection test (`GET /2/users/me`) is a User read ($0.010, or $0.001 as an "Owned Read" — the pricing page lists Owned Reads for "your own data (posts, bookmarks, followers, etc.)"; whether `/2/users/me` qualifies is unverified).
- **3 million Post reads / month** hard cap on self-serve.
- **Per-user 100 posts / 15 min** and **per-app 10,000 posts / 24 h**.
- **Media limits follow the *authenticated X user's* Premium status, not the developer plan**: "Specification limits follow the authenticated user (X Premium / verified status), not your developer API plan." (best-practices page).

## Date-sensitive items to re-check on refresh

- Pay-per-use prices and the 2026-04-16 restrictions (quote-posts removed from self-serve; programmatic replies only when "summoned", changelog 2026-02-23).
- Whether legacy Free/Basic/Pro still exist for existing subscribers.
- Media duration/size limits (changelog 2026-09-01: default 20 min / 8 GB, Premium 125 min / 16 GB for `tweet_video`).
- Rate-limit table values above.
