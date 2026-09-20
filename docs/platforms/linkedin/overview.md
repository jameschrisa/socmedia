---
platform: linkedin
topic: overview
sources:
  - https://learn.microsoft.com/en-us/linkedin/marketing/versioning
  - https://learn.microsoft.com/en-us/linkedin/marketing/integrations/migrations
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review
  - https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access
  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access
  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
  - https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits
fetched: 2026-09-19
---

# LinkedIn: platform overview for suprstar

This file describes what the LinkedIn APIs that suprstar uses can do, how access is granted, and the quotas that apply. It is written against the suprstar adapter in `server/src/platforms/linkedin.ts` and the shared spec in `shared/src/platforms.ts`.

## What suprstar uses on LinkedIn

suprstar talks to three LinkedIn API surfaces:

| Surface | Endpoint(s) suprstar calls | Purpose in suprstar |
| --- | --- | --- |
| OAuth 2.0 (3-legged) | `https://www.linkedin.com/oauth/v2/authorization`, `https://www.linkedin.com/oauth/v2/accessToken` | Connect button, token exchange, "Refresh token" button |
| Sign In with LinkedIn using OpenID Connect | `GET https://api.linkedin.com/v2/userinfo` | Profile fetch after connect; the **Test connection** button |
| Marketing API (versioned, `/rest/`) | `POST https://api.linkedin.com/rest/images?action=initializeUpload`, `PUT {uploadUrl}`, `POST https://api.linkedin.com/rest/posts` | Publishing image and text posts |

Metrics are not fetched from LinkedIn: `fetchMetrics` in the adapter returns `[]`. Live LinkedIn connections therefore never populate analytics; only sandbox connections produce (simulated) metrics.

Source: `server/src/platforms/linkedin.ts` (suprstar), https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api

## Versioned Marketing API (date-sensitive)

Every call to `https://api.linkedin.com/rest/...` must carry two headers:

- `Linkedin-Version: YYYYMM` (the docs write it as "Linkedin-Version"; the header name is case-insensitive, suprstar sends `LinkedIn-Version`)
- `X-Restli-Protocol-Version: 2.0.0`

LinkedIn: "LinkedIn expects every versioned API call to specify a version; the latest version is not applied by default." Versions are released monthly and "supported and stable for a minimum of one year before sunset."

### Which versions are active as of 2026-09-19

From the migrations page (verified 2026-09-19):

| Version | Sunset date | Status |
| --- | --- | --- |
| 202609 (latest) | September 15, 2027 | Active |
| 202608 | August 17, 2027 | Active |
| 202607 | July 15, 2027 | Active |
| 202606 | June 15, 2027 | Active |
| 202605 | May 15, 2027 | Active |
| 202604 | April 15, 2027 | Active |
| 202603 | March 16, 2027 | Active |
| 202602 | February 15, 2027 | Active |
| 202601 | January 15, 2027 | Active |
| 202511 | November 16, 2026 | Active |
| 202510 | October 15, 2026 | Active (sunset warning banner is live) |
| 202509 | September 15, 2026 | **Deprecated** |
| **202409** | **September 15, 2025** | **Deprecated** |

### suprstar's version constant is sunset

`server/src/platforms/linkedin.ts` hard-codes `const LI_VERSION = "202409";` and sends it on every `/rest/images` and `/rest/posts` call. LinkedIn lists 202409 as **Deprecated** with a sunset date of **September 15, 2025**. Requests with a sunset version are rejected with:

```json
{
  "status": 426,
  "code": "NONEXISTENT_VERSION",
  "message": "Requested version yyyymmdd is not active"
}
```

Consequence for suprstar: **every live LinkedIn publish fails** at the first `/rest/images?action=initializeUpload` call (image posts) or the `/rest/posts` call (text-only posts) with HTTP 426. The connection test still passes because `/v2/userinfo` is not versioned. Fix: bump `LI_VERSION` to an active value (`202609` is the latest as of the fetch date) and plan to bump it at least once a year. This is the single most likely cause of "connection test passes but publish fails immediately" on LinkedIn.

If the header is missing entirely:

```json
{
  "status": 400,
  "code": "VERSION_MISSING",
  "message": "A version must be present. Please specify a version by adding the Linkedin-Version header."
}
```

Source: https://learn.microsoft.com/en-us/linkedin/marketing/versioning, https://learn.microsoft.com/en-us/linkedin/marketing/integrations/migrations, https://learn.microsoft.com/en-us/linkedin/marketing/error-responses

## Products and permissions

LinkedIn grants OAuth scopes by adding "Products" to the app in the Developer Portal (My Apps > app > Products tab). The Auth tab then lists the scopes the app may request. Requesting a scope that is not provisioned fails at the authorization step (see `oauth.md`).

### Open (self-serve) products

Available to every developer without review:

| Product | Permission | What it gives suprstar |
| --- | --- | --- |
| Sign In with LinkedIn using OpenID Connect | `openid` | Required to use OIDC; returns an ID token |
| Sign In with LinkedIn using OpenID Connect | `profile` | `/v2/userinfo` returns `sub`, `name`, `given_name`, `family_name`, `picture`, `locale` |
| Sign In with LinkedIn using OpenID Connect | `email` | `/v2/userinfo` also returns `email`, `email_verified` (suprstar does **not** request this scope) |
| Share on LinkedIn | `w_member_social` | "Post, comment and like posts on behalf of an authenticated member." Needed to publish as `urn:li:person:{sub}` |

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access

### Vetted product: Community Management API

Needed for the organization scopes suprstar requests by default (`r_organization_social`, `w_organization_social`). This product is "a Vetted Product with development and standard tiers" and "only available to registered legal organizations for commercial use cases only."

Permissions granted on approval include `r_1st_connections_size`, `r_basicprofile`, `r_organization_followers`, `r_organization_social`, `r_organization_social_feed`, `rw_organization_admin`, `w_member_social`, `w_member_social_feed`, `w_organization_social`, `w_organization_social_feed` (plus `r_member_profileAnalytics` from 202504 and `r_member_postAnalytics` from 202506).

`r_member_social` "is a **closed** permission. We're not accepting access requests at this time."

Source: https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview

### Access review process (Community Management)

Development tier review checks: "Approved use case", "Verified business email address", "Verified organization", "Verified organization website and domain address", and that the app is "verified by LinkedIn Page associated with same organization". Personal email addresses "won't pass the vetting process." If rejected, "You won't be able to re-apply for Development tier access with your existing app" (a new app must be created).

Standard tier requires a completed integration, a screencast demonstrating each use case (including "an application user approving access to their LinkedIn page data via the complete OAuth flow" and "a user posting to their LinkedIn page via your app"), test credentials, and a privacy policy.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review

## Tiers and quotas

### Community Management tiers

| Tier | What it allows |
| --- | --- |
| Development | "**500** API calls for an app for **24** hrs", "**100** API calls per member of an App for **24** hrs", "All APIs with BATCH_GET: No API calls allowed", "Webhook for Social Actions: Push notifications disabled". Must finish integration "within twelve (12) months of the provisioning." |
| Standard | "No restrictions" |

Source: https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access

### Share on LinkedIn (self-serve) rate limits

| Throttle type | Daily request limit (UTC) |
| --- | --- |
| Member | 150 requests |
| Application | 100,000 requests |

Source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin

### General rate limit behaviour

- Limits are per 24-hour period and "reset at midnight UTC every day."
- Two limit kinds: **Application** (all calls by the app per day) and **Member** (calls per member token per app per day).
- "Rate limited requests will receive a 429 response."
- Exact per-endpoint limits are "not published in documentation"; look them up in Developer Portal > app > **Analytics** tab (only endpoints called at least once today appear).
- Admins get email alerts at 75% of the app-level quota, delayed "approximately 1–2 hours".

Source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits

## Sandbox vs production

LinkedIn has no sandbox for organic posting. suprstar's **Mode** toggle (Sandbox / Live) on the Social Profiles card back is suprstar's own simulation layer (`server/src/platforms/sandbox.ts`): in Sandbox mode the connect, test, publish and metrics calls never reach LinkedIn. Only Live mode uses the credentials on the card. LinkedIn does offer "Test Ad Accounts" for the Advertising API, which suprstar does not use.

Source: `server/src/platforms/sandbox.ts` (suprstar)

## Token lifetimes at a glance

- Access token: 60 days (`expires_in: 5184000`).
- Programmatic refresh token: 365 days, only for approved Marketing Developer Platform partners; otherwise the member must re-run the OAuth flow before the 60 days elapse.
- Authorization code: 30 minutes, single use.

Details and failure modes are in `oauth.md`.

Source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow, https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens

## Date-sensitive items to re-check on refresh

- `LI_VERSION` in the adapter vs the active version table (monthly releases, one-year support).
- Community Management Development tier quotas (500/app/day, 100/member/day) were "increased" from 100/10; may change again.
- Share on LinkedIn limits (150/member/day, 100,000/app/day).
- `r_member_social` closed status.
