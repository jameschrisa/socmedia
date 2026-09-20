---
platform: linkedin
topic: troubleshooting
sources:
  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
  - https://learn.microsoft.com/en-us/linkedin/marketing/versioning
  - https://learn.microsoft.com/en-us/linkedin/marketing/integrations/migrations
  - https://learn.microsoft.com/en-us/linkedin/marketing/error-responses
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api
  - https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits
  - https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics
fetched: 2026-09-19
---

# LinkedIn: troubleshooting checklist for suprstar

Each entry: symptom -> likely causes -> what to check on the Social Profiles card back (flip the card: Account, API credentials, Redirect URI, Scopes, Mode, Default post settings, Token status) -> fix. "Reconnect" means: card back > Disconnect, then front > Connect, complete LinkedIn consent.

## Before anything else: Mode

If the card's **Mode** is **Sandbox**, nothing reaches LinkedIn. Connect succeeds instantly with a fake token, Test connection reports "Sandbox connection healthy", publishes return `sb_` IDs and fake `linkedin.com/feed/update/urn:li:share:sb_...` URLs, and metrics are simulated. Any real-world complaint ("not on LinkedIn", "metrics look fake") for a Sandbox card is expected behaviour. Switch to **Live** and reconnect.

Source: `server/src/platforms/sandbox.ts` (suprstar)

## Symptom: Connect button loops back / lands on /connections?error=...

Likely causes:

1. Redirect URI mismatch (`Redirect_uri doesn't match`, or at token exchange `invalid_redirect_uri` "Unable to retrieve access token: appid/redirect uri/code verifier does not match authorization code...").
2. Scope not provisioned (`Invalid scope` / `unauthorized_scope_error`).
3. Wrong Client ID/secret (`Client_id doesn't match`, `invalid_client`).
4. Member cancelled (`user_cancelled_authorize`), which suprstar shows as "Missing code or state parameter".
5. Card deleted mid-flow ("Unknown connection").
6. Authorization code expired (>30 min) or reused.

Check on the card back:

- **Redirect URI**: must equal, character for character, an entry under the LinkedIn app's Auth tab "Authorized redirect URLs for your app". Use the "Copy suggested redirect URI" button (`{origin}/api/connections/oauth/callback`) and paste that exact value into the portal. No trailing slash differences, no `#`, HTTPS in production.
- **Scopes**: compare ticked boxes with the Auth tab's listed scopes. If the app only has "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn", untick `r_organization_social` and `w_organization_social`.
- **Client ID / Client secret**: re-paste from the Auth tab; check for leading/trailing spaces. If the secret was regenerated in the portal, the card still holds the old one.
- **Mode**: Live.

Fix: correct the field(s), Save, Connect again. If LinkedIn shows "Bummer, something went wrong", treat it as a redirect/scope mismatch first.

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow

## Symptom: Connection test fails

The test is `GET https://api.linkedin.com/v2/userinfo` with the stored token. Read the "LinkedIn API reachable" detail line: it contains LinkedIn's message.

| Message on the card | Cause | Fix |
| --- | --- | --- |
| "Access token present: false" / "Empty oauth2_access_token" | Never connected, or Disconnected | Connect. |
| "Expired access token" | 60 days elapsed | Reconnect. Refresh button will not work (see next symptom). |
| "The token has been revoked" | User removed the app under LinkedIn Settings > Data privacy > Permitted services | Reconnect. |
| "Invalid access token" | Token issued for a different Client ID (credentials changed after connecting) or corrupted | Reconnect. |
| 403 "Not enough permissions to access" / `ACCESS_DENIED` | Token lacks `openid` + `profile` | Tick both scopes, reconnect. |
| `LinkedIn profile fetch failed (500)` | LinkedIn-side token verification failure | Retry; if persistent reconnect. |
| Network / DNS error | Server cannot reach api.linkedin.com | Check egress/proxy. |

Also check: **Token status** section shows `tokenExpiresAt`; if it is in the past, reconnect regardless of message. A passing test does **not** prove publishing will work: `/v2/userinfo` is unversioned and needs only `openid profile`, whereas publishing needs an active `Linkedin-Version` and `w_member_social` / `w_organization_social`.

Source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2, https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling

## Symptom: Token expired every day / Refresh token button fails

Likely causes:

1. **Refresh button always fails in suprstar**: the adapter never stores `refresh_token`, so the request is sent with an empty value and LinkedIn returns `invalid_request` "A required parameter "refresh_token" is missing". This is a code limitation, not a configuration problem.
2. Even with the fix, "Programmatic refresh tokens are available for a limited set of partners" (approved Marketing Developer Platform apps). Self-serve apps get 60-day access tokens and no refresh token.
3. "If you request a different scope than the previously granted scope, all the previous access tokens are invalidated." Two cards on the same LinkedIn app with different Scopes ticked will invalidate each other every time one reconnects. Symptom: a card that was fine is suddenly 401 after a sibling card reconnected.
4. Member changed their LinkedIn password or revoked the app.

Check on the card back:

- **Token status**: `tokenExpiresAt` should be ~60 days after connect. If it is 1 hour, the card is in Sandbox mode (sandbox tokens expire in 3600 s).
- **Scopes** on every LinkedIn card that shares the same Client ID: make them identical.

Fix: reconnect; align scopes across sibling cards; plan a reconnect before day 60 (LinkedIn: "Make sure your application refreshes access tokens before they expire"). To make Refresh work at all, the adapter must persist `data.refresh_token` from the token exchange and the app must be MDP-approved.

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens, https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow

## Symptom: Publish fails immediately (job "failed" within seconds)

Read the job error string. Ordered by likelihood:

1. **"Requested version 202409 is not active"** (HTTP 426, `NONEXISTENT_VERSION`). `LI_VERSION` in `server/src/platforms/linkedin.ts` is sunset (2025-09-15). Every live LinkedIn publish fails this way until the constant is bumped to an active version (202609 as of 2026-09-19; active versions listed in `overview.md`). No card setting fixes this.
2. **401** "Expired access token" / "The token has been revoked" / "Empty oauth2_access_token": token gone. suprstar does not refresh before publishing. Reconnect, then re-run the job.
3. **403** `ACCESS_DENIED` "Insufficient permissions to perform the requested action": missing `w_member_social` (personal) or `w_organization_social` (Page), or the member is not `ADMINISTRATOR` / `CONTENT_ADMIN` / `DIRECT_SPONSORED_CONTENT_POSTER` on that Page. Check **Scopes** and, for Page posts, **Post as organization** + the member's role on the Page.
4. **403** "Accessing this image resource is forbidden. Please check your permissions for this resource": image `owner` URN not allowed for this token, almost always an Organization ID problem or a Page role problem.
5. **400** `INVALID_URN_ID` / `INVALID_URN_TYPE`: **Organization ID** contains `urn:li:organization:` (enter digits only), or `credentials.extra.sub` is empty because the profile fetch never succeeded (reconnect).
6. **400** `FIELD_LENGTH_TOO_LONG`: caption > 3,000 characters.
7. **400** `INVALID_VALUE_FOR_FIELD` or a parse error on `commentary`: caption contains unescaped reserved characters `( ) [ ] { } < > @ | ~ _ * # \`. Remove them or escape with `\`. `#tag` hashtags are fine; `(text)`, `user@host`, `*bold*`, `_x_` are not.
8. **422** "Content is a duplicate of urn:li:share:...": same author, same content within 10 minutes. See "Duplicate content rejected".
9. **429**: quota exhausted. See "Rate limited".
10. **"LinkedIn image upload failed (4xx)"**: PUT to `uploadUrl` failed. Upload URL expired (`uploadUrlExpiresAt`), or file not JPG/PNG/GIF, or > 36,152,320 pixels.

Card-back checks in order: Mode = Live; Token status not expired; Scopes include `w_member_social` (and `w_organization_social` if Post as organization); Organization ID numeric; Test connection passes. Then check server logs for the HTTP status.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/error-responses, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format

## Symptom: Post stuck "processing"

suprstar has no processing state for LinkedIn: `/rest/posts` returns 201 synchronously and the job is marked succeeded. If a post shows `publishing` for long, the request itself is hanging (504 Gateway Timeout / network). LinkedIn side, a post can sit in `lifecycleState: PUBLISH_REQUESTED` ("submitted for publishing but is not yet ready for rendering") while media processes, or end in `PUBLISH_FAILED` ("An edit is required in order to re-attempt publishing").

Check: `GET https://api.linkedin.com/rest/posts/{encoded urn}?viewContext=AUTHOR` (needs `r_member_social`, which is closed, for personal posts; `r_organization_social` for Page posts) and inspect `lifecycleState` and `lifecycleStateInfo.contentStatus` (`PENDING`, `PROCESSING`, `FAILED`). For images: `GET /rest/images/{urn}` status `PROCESSING` / `AVAILABLE` / `PROCESSING_FAILED` (a `w_member_social`-only token cannot GET images on the versioned gateway).

Fix: if the job timed out, do not blindly retry; check the member's feed or the Page first, since the post may already exist (a retry would hit the 422 duplicate rule, which is a useful confirmation).

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api

## Symptom: Post published but not visible

Likely causes:

1. **Image failed processing after the post was created.** suprstar posts immediately after the PUT without waiting for the image to be `AVAILABLE`. LinkedIn: "If the post is created before confirming image upload success and the image upload fails to process, the post won't be visible to members." Check the image format/size limits (JPG/PNG/GIF, < 36,152,320 px).
2. **Wrong author.** Post as organization was on: the post is on the Company Page, not the member's profile (or vice versa). Check **Post as organization** and **Organization ID**.
3. **Looking at the wrong URL.** suprstar's `externalUrl` is `https://www.linkedin.com/feed/update/{x-restli-id}`; if `x-restli-id` was empty the URL ends in `/feed/update/`. Open the author's Activity page instead.
4. **Video post.** Videos are skipped by the adapter; the post exists but is text-only.
5. **Sandbox mode** (see top).
6. **Dark post** (`feedDistribution: NONE`): not produced by suprstar, but a LinkedIn admin may be looking at a post created elsewhere.
7. Content removed by LinkedIn moderation after publish (not detectable via API without `r_*_social`).

Fix: for cause 1, re-upload with a compliant image; the adapter should ideally poll `GET /rest/images/{urn}` until `AVAILABLE` before `POST /rest/posts`.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api

## Symptom: Metrics empty

Expected for every **Live** LinkedIn card: `fetchMetrics` returns `[]`; suprstar never calls a LinkedIn analytics endpoint. Only Sandbox cards show (simulated) metrics.

To implement: Page metrics need `rw_organization_admin` (Community Management API, ADMINISTRATOR role) and `GET /rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A{id}` with optional `shares=List(...)` / `ugcPosts[0]=...`; rolling 12-month window; "Shares with no actions or impressions are not included in the list of elements." Member post metrics need `r_member_postAnalytics` (API >= 202506). None of these scopes are in the card's Scopes list today.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics, https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access, `server/src/platforms/linkedin.ts` (suprstar)

## Symptom: Duplicate content rejected

Error: 422 "Content is a duplicate of {share or UGC URN}". LinkedIn: "Indicates the UGC Post is an exact duplicate of a recently created UGC Post. Wait 10 minutes for the duplicate restriction to expire or modify the content."

Likely causes:

1. A previous attempt actually succeeded (e.g. the job timed out after LinkedIn created the post) and the retry is the duplicate. Check the feed before retrying.
2. Two suprstar cards for the same LinkedIn member/Page (e.g. "Main" and "Founder" both pointing at the same person) publishing the same post.
3. Re-publishing an identical caption within 10 minutes.

Fix: wait 10 minutes or change the caption; deduplicate targets so the same author is not selected twice; when a job fails with a timeout, verify on LinkedIn before re-running.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api

## Symptom: Rate limited (429)

Message: "Resource level throttle limit for calls to this resource is reached."

Likely causes:

1. Community Management **Development tier** limits: 500 calls/app/day, 100 calls/member/day. Each image post is ~3 calls; each Test connection is 1; a busy day with several cards can hit 100/member.
2. Self-serve Share on LinkedIn: 150/member/day, 100,000/app/day.
3. Frequent Test connection clicks or a scheduler retry loop.
4. LinkedIn infrastructure protection (rare; resolves on its own).

Check: Developer Portal > app > **Analytics** > Quotas and usage (only shows endpoints called today, UTC). Confirm which tier the app is on (Products tab).

Fix: stop retries until midnight UTC (limits "reset at midnight UTC every day"); reduce Test connection use; apply for Standard tier ("No restrictions") if volume is legitimate; spread multi-card publishes across time. There are no documented `Retry-After` headers to key off.

Source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits, https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access, https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin

## Quick reference: card-back field -> LinkedIn portal location

| Card field | Where it comes from |
| --- | --- |
| Client ID, Client secret | Developer Portal > My Apps > app > **Auth** tab > Application credentials |
| Redirect URI | Auth tab > OAuth 2.0 settings > "Authorized redirect URLs for your app" (must match exactly) |
| Scopes checkboxes | Auth tab > "OAuth 2.0 scopes" (only listed scopes may be ticked); add scopes via **Products** tab |
| Post as organization + Organization ID | Numeric ID of the Company Page (number in the Page admin URL, or `organization` in `GET /rest/organizationAcls?q=roleAssignee`); member must be ADMINISTRATOR / CONTENT_ADMIN / DSC poster |
| Token status | Populated by suprstar from `expires_in` (60 days) |
| Mode | suprstar only; Sandbox never contacts LinkedIn |

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
