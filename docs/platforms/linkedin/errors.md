---
platform: linkedin
topic: errors
sources:
  - https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling
  - https://learn.microsoft.com/en-us/linkedin/marketing/error-responses
  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api
  - https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
fetched: 2026-09-19
---

# LinkedIn: error reference for suprstar

## Error response shape

Standard body:

```json
{ "message": "Empty oauth2_access_token", "serviceErrorCode": 401, "status": 401 }
```

Newer endpoints add `code` (string constant), `errorDetailType` and `errorDetails`. "If you're getting `code` in the response, it means you're getting the new error response." OAuth endpoints use the OAuth2 shape `{ "error": "...", "error_description": "..." }`.

How suprstar surfaces them: the adapter throws `PlatformError` with `data.message` (API calls) or `data.error_description || data.error` (OAuth calls); when the body has neither, it uses `LinkedIn <step> failed (<status>)`. Publish jobs store that string in the job's error and the post moves to `failed` / `partially_published`. OAuth callback failures redirect to `/connections?error=<message>`. Note that when the `/rest` gateway rejects a request before routing (426, 400 VERSION_MISSING), `message` is present, so the user sees LinkedIn's text.

Source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling, https://learn.microsoft.com/en-us/linkedin/marketing/error-responses, `server/src/platforms/linkedin.ts` (suprstar)

## Errors by suprstar operation

Operation column: **connect** = authorize + token exchange, **test** = `/v2/userinfo`, **publish** = images + posts, **refresh** = Refresh token button, **metrics** = not implemented (reference only).

| Op | HTTP | Code / message (exact) | Meaning | Recommended fix |
| --- | --- | --- | --- | --- |
| connect | 401 | `Redirect_uri doesn't match` | Redirect URI in request differs from app config | Make card Redirect URI identical to an Auth-tab entry; no `#`, absolute URL. |
| connect | 401 | `Client_id doesn't match` | Client ID unknown | Re-copy Client ID from Auth tab. |
| connect | 401 | `Invalid scope` / `unauthorized_scope_error` | Scope not provisioned to the app | Untick unprovisioned scopes (usually the two `*_organization_social` ones) or add the product. |
| connect | redirect | `user_cancelled_login`, `user_cancelled_authorize` | Member cancelled | Retry. suprstar shows "Missing code or state parameter". |
| connect | 401 | `invalid_request` "Unable to retrieve access token: authorization code not found" | Code invalid or reused | Retry Connect. |
| connect | 400 | `invalid_redirect_uri` "Unable to retrieve access token: appid/redirect uri/code verifier does not match authorization code. Or authorization code expired. Or external member binding exists" | redirect_uri mismatch between authorize and token call, or code >30 min old | Do not change the card between clicking Connect and returning; retry promptly. |
| connect | 400 | `invalid_request` "A required parameter "client_secret" is missing" | Blank secret | Fill Client secret on card. |
| connect | 400 | `invalid_request` "A required parameter "redirect_uri" is missing" | Blank redirect | Fill Redirect URI. |
| connect | 400/401 | `invalid_client` | Wrong secret (message text unverified) | Re-paste secret; rotate in portal if needed. |
| connect/test | n/a | `Unknown connection` (suprstar) | `state` decoded to a connection id that no longer exists | Card was deleted mid-flow; create a new card and Connect. |
| test | 401 | "Empty oauth2_access_token" / "Empty OAuth2 access token" | No token stored | Connect. |
| test | 401 | "Invalid access token" | Token from another app or corrupted | Disconnect, Connect. |
| test | 401 | "Expired access token" | 60-day lifetime elapsed | Connect (refresh does not work without MDP approval). |
| test | 401 | "The token has been revoked" | Member revoked app in LinkedIn settings | Connect again. |
| test | 403 | `ACCESS_DENIED` / "Not enough permissions to access: ..." | Token lacks `openid`/`profile` for `/v2/userinfo` | Tick `openid` and `profile`, reconnect. |
| test | 500 | Internal Server Error | "Access token downstream verification failures return a 500" | Reconnect; if persistent, capture `x-li-uuid` and open a support ticket. |
| refresh | 400 | `invalid_request` "A required parameter "refresh_token" is missing" | suprstar sends an empty refresh_token (never stored) | Expected; reconnect instead. Fix adapter to persist `refresh_token` if the app is MDP-approved. |
| refresh | 400 | `invalid_request` "The provided authorization grant or refresh token is invalid, expired or revoked" | Refresh token expired (365 d) or revoked | Reconnect. |
| publish | 426 | `NONEXISTENT_VERSION` "Requested version yyyymmdd is not active" | `Linkedin-Version` is sunset (suprstar's `202409` sunset 2025-09-15) | Update `LI_VERSION` in `server/src/platforms/linkedin.ts` to an active version (202609 latest at fetch). |
| publish | 400 | `VERSION_MISSING` "A version must be present. Please specify a version by adding the Linkedin-Version header." | Header missing | Not expected from suprstar; check proxies stripping headers. |
| publish | 401 | `EMPTY_ACCESS_TOKEN` "Empty or missing OAuth2 access token" | No token | Connect. |
| publish | 401 | "Expired access token" / "The token has been revoked" | See test | Reconnect. |
| publish | 403 | `ACCESS_DENIED` "Insufficient permissions to perform the requested action" | Missing `w_member_social` (person) or `w_organization_social` (org), or member lacks Page role | Tick the scope, reconnect; for org posts confirm ADMINISTRATOR / CONTENT_ADMIN / DIRECT_SPONSORED_CONTENT_POSTER on the Page. |
| publish | 403 | "Accessing this image resource is forbidden. Please check your permissions for this resource" | Image `owner` URN not permitted for this token (org without admin role, or person URN differs from token owner) | Fix Organization ID / Post as organization; ensure `owner` equals `author`. |
| publish | 400 | `INVALID_URN_TYPE` "{field} value {value} must be a {urnType} URN" | `author` / `content.media.id` wrong type | Organization ID field must contain only digits; image IDs must be `urn:li:image:`. |
| publish | 400 | `INVALID_URN_ID` "The URN ID provided is invalid" | Malformed URN (e.g. `urn:li:person:` with empty sub, or doubled `urn:li:organization:` prefix) | Reconnect so `sub` is stored; enter numeric Organization ID. |
| publish | 400 | `MISSING_FIELD` "{field} is required but missing" | Required Posts field absent | Not expected from suprstar's fixed body. |
| publish | 400 | `INVALID_VALUE_FOR_FIELD` "{field} can't be set to {value}" | Bad enum, or unescaped little-text | Escape reserved chars in caption (see `publishing.md`). |
| publish | 400 | `FIELD_LENGTH_TOO_LONG` "{field} length {length} can't exceeded maximum {max} length" | `commentary` > 3,000 chars | Shorten caption. |
| publish | 400 | `INVALID_VALUE_BLANK_FIELD` "{field} can't be blank" | Empty commentary | Add text (LinkedIn requires `commentary`). |
| publish | 400 | `INVALID_IMAGE_ID` "This Image ID is invalid" | Image URN unknown/not uploaded | Retry upload; ensure PUT returned 201. |
| publish | 400 | `MEDIA_ASSET_WAITING_UPLOAD` "Media asset is waiting upload" | Post referenced media whose upload/finalize did not complete | Confirm PUT succeeded (201). For video (not implemented) finalizeUpload first. |
| publish | 400 | `MEDIA_ASSET_PROCESSING_FAILED` "Media asset failed processing" | Unsupported/oversized media | Use JPG/PNG/GIF under 36,152,320 px; MP4 3 s–30 min, 75 KB–500 MB. |
| publish | 400 | `EXPIRED_UPLOAD_URL` "The Video upload URL is expired" | Video upload URL past expiry | Re-initialize upload. |
| publish | 404 | `NOT_FOUND` "Could not find entity" | Post/asset URN does not exist | Check URN; may also mask a 403 on restricted APIs. |
| publish | 409 | `CONFLICT` "A write conflict occurred. Retry the request." | Concurrent write | Retry once after a short delay. |
| publish | 411 | Length Required | POST without `Content-Length` | Not expected (suprstar sends JSON bodies). |
| publish | 413 | `REQUEST_ENTITY_TOO_LARGE` | Upload too big | Reduce file size. |
| publish | 415 | `UNSUPPORTED_MEDIA_TYPE` | Wrong file format | JPG/PNG/GIF or MP4. |
| publish | 422 | `UNPROCESSABLE_ENTITY` / "Content is a duplicate of {share or UGC URN}" | Exact duplicate of a recent post by the same author | "Wait 10 minutes for the duplicate restriction to expire or modify the content." |
| publish | 429 | `TOO_MANY_REQUESTS` / "Resource level throttle limit for calls to this resource is reached." | Daily app or member quota hit | Back off; see below. |
| publish | 500 | `INTERNAL_SERVER_ERROR` | LinkedIn-side | Retry with backoff; report with `x-li-uuid`, `x-li-fabric`, `x-li-request-id` if persistent. |
| publish | 503 | `SERVICE_UNAVAILABLE` / `UNDER_MAINTENANCE` | Temporary | Retry after delay. |
| publish | 504 | Gateway Timeout | Slow processing | Retry with backoff; do not assume failure without checking (a post may still have been created; see duplicate 422 on retry). |
| metrics | 403 | `ACCESS_DENIED` | `rw_organization_admin` not granted / not ADMINISTRATOR | Not implemented in suprstar; would need Community Management product. |
| org lookup | 401 / 403 / 404 | (organizationAcls) "Malformed requests" / "user is not authorized" / "The Access Control doesn't exist" | Wrong URN or no role | Verify Page role in LinkedIn UI. |

Source: all URLs in front matter.

## HTTP status semantics (LinkedIn guidance)

- **400**: bad syntax in URL or body; "Check if an invalid character is included in the URL."
- **401**: header problem ("Unknown authentication schema", "Empty OAuth2 access token", "Invalid access token", "Expired access token", "The token has been revoked").
- **403**: "If the access token does not have the correct permissions"; check "Does your application have permissions to make the API call? Does your application ask the user to enable these permissions? Did your application change the scope while requesting an access token?"
- **404**: wrong path or missing entity; "In some cases (Ads, for example), a 404 error is returned when attempting to access a restricted API."
- **405**: method not supported.
- **411**: missing `Content-Length` on an empty-body POST.
- **426**: "the version passed in the request header X-LinkedIn-Version has been deprecated (e.g., 202401)."
- **429**: rate limit; "Resource level throttle limit for calls to this resource is reached."
- **500**: internal; report request URL/method/headers and response headers `x-li-uuid`, `x-li-fabric`, `x-li-request-id`.
- **504**: gateway timeout; "Make sure you have proper error handling logic, such as caching and retry patterns."

Source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling

## Rate limits and backoff

### What LinkedIn provides

- Limits are daily (24 h) and "reset at midnight UTC every day", at two levels: Application and Member.
- 429 body message: "Resource level throttle limit for calls to this resource is reached."
- "In rare cases, LinkedIn may also return a 429 response as part of infrastructure protection. API service will return to normal automatically."
- No `X-RateLimit-*` or `Retry-After` response headers are documented on learn.microsoft.com for the Marketing/Consumer APIs (unverified: none observed in the documentation). Remaining quota is only visible in Developer Portal > app > Analytics ("Quotas and usage").
- The only official numeric retry guidance is for DMP streaming: "retry after a minimum of 1 second whenever you receive an HTTP 429 response."

### Known quotas

| Scope | Limit |
| --- | --- |
| Share on LinkedIn (self-serve) | 150 requests / member / day; 100,000 / app / day |
| Community Management Development tier | 500 calls / app / day; 100 / member / day; BATCH_GET disabled |
| Community Management Standard tier | "No restrictions" (still subject to unpublished per-endpoint limits) |

Each suprstar image post costs 2 calls per image (`initializeUpload` + PUT; the PUT goes to `www.linkedin.com/dms-uploads`, whether it counts against `/rest/images` quota is unverified) plus 1 for `/rest/posts`. A connect costs 1 token call plus 1 `/v2/userinfo`; each Test connection costs 1 more.

### Recommended backoff for suprstar

- **429**: do not retry within the same minute. Because limits are daily, schedule the retry for a later slot; if the member-level limit is hit (100/day on Development tier, 150/day on self-serve), further retries the same UTC day will fail. Retry after midnight UTC at the latest.
- **500 / 503 / 504**: exponential backoff starting at 1 s, max 3 attempts, then fail the job. Before retrying a `/rest/posts` timeout, be aware a duplicate may already exist (422 on retry confirms the first attempt succeeded).
- **409 CONFLICT**: one immediate retry.
- **426 / 400 VERSION_MISSING / 401 / 403**: do not retry; these are configuration errors.

Source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits, https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access, https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin, https://learn.microsoft.com/en-us/linkedin/marketing/integrations/archived-recent-changes/2020/marketing-api-changes

## Headers worth logging for support tickets

Response headers `x-li-uuid`, `x-li-fabric`, `x-li-request-id`, plus the request URL, method, `Linkedin-Version`, and the app Client ID. Support: https://www.linkedin.com/help/linkedin/ask/dsapi.

Source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling
