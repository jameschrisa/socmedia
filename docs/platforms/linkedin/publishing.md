---
platform: linkedin
topic: publishing
sources:
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/versioning
fetched: 2026-09-19
---

# LinkedIn: publishing posts from suprstar

All endpoints in this file are on the versioned Marketing API base `https://api.linkedin.com/rest/` and require `Linkedin-Version: YYYYMM` and `X-Restli-Protocol-Version: 2.0.0`. suprstar sends `LinkedIn-Version: 202409`, which is sunset (see `overview.md`); every request below returns HTTP 426 `NONEXISTENT_VERSION` until that constant is updated.

## What suprstar sends, end to end

For each publish job (`publish()` in `server/src/platforms/linkedin.ts`):

1. For every attached asset with `kind === "image"`: `POST /rest/images?action=initializeUpload` with `{ "initializeUploadRequest": { "owner": <authorUrn> } }`, then `PUT <uploadUrl>` with the raw bytes and `Authorization: Bearer`. Collects the returned `urn:li:image:...` IDs.
2. Assets with `kind === "video"` are **skipped silently**. A post containing only a video becomes a text-only post; the Videos API is never called.
3. `POST /rest/posts` with:

```json
{
  "author": "urn:li:person:{sub}"  or  "urn:li:organization:{organizationId}",
  "commentary": "<effective caption, sent unescaped>",
  "visibility": "PUBLIC",
  "distribution": { "feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": [] },
  "lifecycleState": "PUBLISHED",
  "isReshareDisabledByAuthor": false,
  "content": { "media": { "id": "urn:li:image:..." } }            // exactly one image
  "content": { "multiImage": { "images": [ { "id": "..." }, ... ] } }  // two or more images
}
```

4. Reads the post ID from the `x-restli-id` response header and builds `externalUrl = https://www.linkedin.com/feed/update/{postId}`.

The card's Privacy, Allow comments and Auto-hashtags settings are not sent to LinkedIn; visibility is always `PUBLIC`.

Source: `server/src/platforms/linkedin.ts` (suprstar)

## Author URN and organization posting

- Person: `urn:li:person:{sub}` where `sub` comes from `/v2/userinfo` at connect time and is stored in `credentials.extra.sub`. If `sub` is missing (connection made before the profile fetch succeeded) the adapter sends `urn:li:person:` and LinkedIn rejects with 400 `INVALID_URN_ID` / `INVALID_URN_TYPE`.
- Organization: when **Post as organization** is on and **Organization ID** is set, the adapter sends `urn:li:organization:${organizationId}`. The field placeholder reads `urn:li:organization:...` but the adapter prepends the prefix itself, so the user must enter **only the numeric ID** (e.g. `2414183`). Entering the full URN yields `urn:li:organization:urn:li:organization:2414183`, which fails with 400 `INVALID_URN_ID`.

LinkedIn requirements for organization posts:

- Scope `w_organization_social`: "Restricted to organizations where the authenticated member has one of the following company page roles: ADMINISTRATOR, DIRECT_SPONSORED_CONTENT_POSTER, CONTENT_ADMIN".
- Image upload with an organization owner: "the caller must have ADMIN or DSC permissions for the company page."
- To discover which organizations the member administers: `GET https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED` (needs `rw_organization_admin` or `r_organization_admin`; response elements carry `organization` / `organizationTarget` as `urn:li:organization:{id}`, `role`, `state`). suprstar does not call this; the admin must look up the numeric ID (it is the number in the Page admin URL) and type it in.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api

## Posts API request schema (fields suprstar uses)

| Field | Required | Values / rules |
| --- | --- | --- |
| `author` | create-only required | `urn:li:person:{id}` or `urn:li:organization:{id}` |
| `commentary` | required | `little` text (see below). Max 3,000 characters ("The maximum length of the text of a UGC Post is 3,000 characters."). suprstar caps captions at 3000 via `captionMaxLength`. |
| `visibility` | required | `PUBLIC`, `CONNECTIONS`, `LOGGED_IN`, `CONTAINER`. suprstar: always `PUBLIC`. |
| `distribution.feedDistribution` | required | `MAIN_FEED` or `NONE` (`NONE` = dark post, not visible on the Page) |
| `distribution.targetEntities` | optional | audience targeting for org posts; must reach >300 members |
| `distribution.thirdPartyDistributionChannels` | optional | `[]` |
| `lifecycleState` | required | "PUBLISHED is the only accepted field during creation." Responses may show `PUBLISH_REQUESTED`, `PUBLISH_FAILED`, `DRAFT`. |
| `isReshareDisabledByAuthor` | optional, default false | |
| `content.media.id` | optional | `urn:li:image:{id}` or `urn:li:video:{id}`; `title` required for documents; `altText` optional |
| `content.multiImage.images[]` | optional | 2 to 20 `urn:li:image:{id}`; "API partners can only create non-sponsored multiImage posts." |
| `content.article` | optional | `source`, `thumbnail` (image URN), `title`, `description`; "The Posts API does not support URL scraping" |

Success: `201 Created`, header `x-restli-id: urn:li:share:...` or `urn:li:ugcPost:...`. Post URL form: `https://www.linkedin.com/feed/update/urn:li:ugcPost:<id>/` (also works with `urn:li:share:<id>`).

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api

## Text rules: little text format, mentions, hashtags

`commentary` is parsed as "little" text. "All reserved characters need to be escaped with a backslash, even if those characters are not used in one of the supported elements or templates."

Reserved characters that must be escaped: `|` `{` `}` `@` `[` `]` `(` `)` `<` `>` `#` `\` `*` `_` `~`

Example from LinkedIn: `"Hello, these are some bullet points:\n\n\\* Point 1\n\\* Point 2\n\\* Point 3"` (in JSON the backslash itself is escaped, so the wire text is `\* Point 1`).

- Hashtag: `#hashtag` (single word) or the template `{hashtag|\#|mytag}` (LinkedIn returns hashtags in this template form on GET).
- Mention: `@[Display Name](urn:li:person:1234)` or `@[Devtestco](urn:li:organization:2414183)`. "Matching is case sensitive." Organization annotations "must match the full name"; member mentions may match first, last or full name.
- Line breaks: `\n` in the JSON string.

suprstar constraint: the adapter sends the caption **unescaped**. Captions containing bare `(`, `)`, `[`, `]`, `@`, `#` in non-hashtag positions, `*`, `_`, `~`, `<`, `>`, `{`, `}`, `|` or `\` may be rejected with 400 (`INVALID_VALUE_FOR_FIELD` or a parse error, exact wording unverified) or render with characters dropped. Plain `#word` hashtags are fine because `#` followed by a word is a valid HashtagElement. Auto-generated hashtags placed on their own line are safe; text such as `(see below)` or `email@example.com` is not.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api

## Images API (what suprstar uses)

### 1. Initialize

```
POST https://api.linkedin.com/rest/images?action=initializeUpload
{ "initializeUploadRequest": { "owner": "urn:li:organization:5583111" } }
```

Response `200`:

```json
{ "value": { "uploadUrlExpiresAt": 1650567510704, "uploadUrl": "https://www.linkedin.com/dms-uploads/...", "image": "urn:li:image:C4E10AQFoyyAjHPMQuQ" } }
```

`owner` "Can be a person(urn:li:person:123), or organization(urn:li:organization:123) URN". `SYNCHRONOUS_UPLOAD` "is not supported in Images API."

### 2. Upload

`PUT {uploadUrl}` with the file body. "The upload call requires a valid OAuth token in the 'Authorization' header. This is different than the upload video call which doesn't accept an OAuth token." Success is `201` with empty body. suprstar sends the bytes with `Authorization: Bearer` and no explicit `Content-Type`.

### 3. Status (suprstar does not poll)

`GET https://api.linkedin.com/rest/images/{urn}` returns `status`: `PROCESSING`, `AVAILABLE`, `PROCESSING_FAILED` ("file size too large, unsupported file format, internal error"), or `WAITING_UPLOAD`. Note: "tokens with only w_member_social permissions would be unable to perform a GET call for rest/images" on the versioned gateway (403 "Accessing this image resource is forbidden. Please check your permissions for this resource").

suprstar creates the post immediately after the PUT without waiting for `AVAILABLE`. LinkedIn's guidance for the old Assets API: "If the post is created before confirming image upload success and the image upload fails to process, the post won't be visible to members." This is the mechanism behind "published but not visible" for image posts.

### Image limits

- "Images with less than 36,152,320 pixels."
- "JPG, GIF, and PNG formats"; "GIF format supports up to 250 frames".
- A byte-size cap is not stated on the Images API page (unverified). Assets API upload errors list `413 REQUEST_ENTITY_TOO_LARGE` and `415 UNSUPPORTED_MEDIA_TYPE`.
- `altText`: "Maximum length is 4,086 characters, recommended length is less than 120 characters." suprstar does not send altText.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api

## Multi-image posts

`content.multiImage.images`: "Minimum of 2 images and maximum of 20 images", each `{ "id": "urn:li:image:...", "altText": "..." }`. "Please ensure that all images being used are owned by the author or organization" (upload `owner` must equal the post `author`). suprstar's `maxMediaCount` for LinkedIn is 9, so the 20 cap is never reached. A single image goes in `content.media`, not `multiImage`.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api

## Videos API (not implemented in suprstar; reference for the gap)

Steps: `POST /rest/videos?action=initializeUpload` with `{ "initializeUploadRequest": { "owner": ..., "fileSizeBytes": N, "uploadCaptions": false, "uploadThumbnail": false } }` -> response `uploadInstructions[]` of `{ uploadUrl, firstByte, lastByte }` in 4 MB parts ("split -b 4194303"), `video` URN, `uploadToken`, `uploadUrlsExpireAt` ("Typically URLs expire 30 days"). `PUT` each part with `Content-Type: application/octet-stream` and **no** Authorization header; save each response `ETag`. Then `POST /rest/videos?action=finalizeUpload` with `{ "finalizeUploadRequest": { "video": ..., "uploadToken": ..., "uploadedPartIds": [etags in order] } }`. Poll `GET /rest/videos/{urn}` until `status` is `AVAILABLE` (or `PROCESSING_FAILED` with `processingFailureReason`). Then `POST /rest/posts` with `content.media.id = urn:li:video:...` and `content.media.title`.

Video limits: "Length: Three seconds to 30 minutes." "File size: Between 75kb and 500MB." "File format: MP4." (`fileSizeBytes` schema says "Maximum allowed Videos size is 5GB" for the upload mechanism; the feed spec is 500MB.) suprstar's `maxVideoSeconds` for LinkedIn is 900 (15 min), within the 30-minute cap.

Errors: `EXPIRED_UPLOAD_URL` "The Video upload URL is expired", `MEDIA_ASSET_PROCESSING_FAILED` "Media asset failed processing", `MEDIA_ASSET_WAITING_UPLOAD` "Media asset is waiting upload" (post created before finalize).

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api

## Privacy / audience options

- `visibility`: `PUBLIC` (anyone), `CONNECTIONS` (1st degree; member posts), `LOGGED_IN`, `CONTAINER`. suprstar hard-codes `PUBLIC`; the card's Privacy dropdown has no effect on LinkedIn.
- `feedDistribution: NONE` creates a dark post (organization only, for ads).
- Targeted organic posts: set `distribution.targetEntities` (geo, seniority, industry, etc.); "The audience you target ... must be greater than 300 members."
- Comments on/off is a separate call (Social Metadata API), not a post field. suprstar's "Allow comments" toggle is not applied to LinkedIn.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api, https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema

## Duplicate content

"422 | Content is a duplicate of {share or UGC URN} | Indicates the UGC Post is an exact duplicate of a recently created UGC Post. Wait 10 minutes for the duplicate restriction to expire or modify the content." (Documented for ugcPosts; the Posts API lists `422 UNPROCESSABLE_ENTITY` generically. Changed from 409 to 422 in October 2020.) Re-running a failed-then-succeeded job, or publishing the same caption to two cards for the same author, triggers this.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api, https://learn.microsoft.com/en-us/linkedin/marketing/integrations/archived-recent-changes/2020/marketing-api-changes

## Metrics (reference; suprstar returns [])

- Organization posts: `GET https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A{id}` (lifetime) or add `&timeIntervals=(timeRange:(start:{ms},end:{ms}),timeGranularityType:DAY)` (time-bound), or `&shares=List(urn%3Ali%3Ashare%3A...)` / `ugcPosts[0]=...` for per-post lifetime stats. Fields: `impressionCount`, `uniqueImpressionsCount`, `clickCount`, `likeCount`, `commentCount`, `shareCount`, `engagement`. Permission: `rw_organization_admin` (member must be `ADMINISTRATOR`). Window: "share data only within the past 12 months". "Shares with no actions or impressions are not included."
- Member posts: `r_member_postAnalytics` (Community Management, API version >= 202506) via the Member Post Statistics API; `r_member_social` is closed.

Neither scope is in suprstar's default list, which is why the adapter leaves metrics unimplemented.

Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics, https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access

## Known constraints summary (suprstar-specific)

| Constraint | Effect | Where to fix |
| --- | --- | --- |
| `LI_VERSION = "202409"` sunset 2025-09-15 | All `/rest/*` calls return 426 | `server/src/platforms/linkedin.ts` |
| Videos skipped | Video posts publish as text-only | adapter (implement Videos API) |
| Caption not little-escaped | 400 or mangled text on captions with reserved chars | adapter |
| No image status polling | Post may be created before image is `AVAILABLE`; invisible post | adapter |
| `refresh_token` not stored | Refresh button always fails; reconnect every 60 days | adapter |
| Organization ID must be numeric | Full URN in the field breaks the author URN | card back input |
| `visibility` fixed to `PUBLIC`, comments setting ignored | Card settings do not apply | adapter |
| Text-only posts allowed (`requiresMedia: false`) | Fine; LinkedIn supports text-only | n/a |
