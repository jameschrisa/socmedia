---
platform: tiktok
topic: publishing
sources:
  - https://developers.tiktok.com/doc/content-posting-api-get-started
  - https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
  - https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
  - https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
  - https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
  - https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
  - https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
  - https://developers.tiktok.com/doc/content-sharing-guidelines
fetched: 2026-09-19
---

# TikTok: publishing via the Content Posting API

## What suprstar does today

Source: suprstar `server/src/platforms/tiktok.ts`

- Requires at least one media asset (error: `TikTok posts require at least one media file.`).
- If `media[0].kind === "video"`: `POST https://open.tiktokapis.com/v2/post/publish/video/init/` with

  ```json
  {
    "post_info": { "title": "<caption>", "privacy_level": "SELF_ONLY", "disable_duet": false, "disable_stitch": false, "disable_comment": false },
    "source_info": { "source": "PULL_FROM_URL", "video_url": "<absolute suprstar media URL>" }
  }
  ```

- Otherwise (photos): `POST https://open.tiktokapis.com/v2/post/publish/content/init/` with

  ```json
  {
    "post_info": { "title": "<caption>", "description": "<caption>" },
    "source_info": { "source": "PULL_FROM_URL", "photo_images": ["<url>", "..."] },
    "post_mode": "DIRECT_POST",
    "media_type": "PHOTO"
  }
  ```

- Headers: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`.
- Success is any HTTP 2xx whose `error.code` is `ok`; the returned `data.publish_id` is stored as `externalId`. `externalUrl` is the profile page `https://www.tiktok.com/@<handle>` (a `publish_id` is not a video id).
- Not done: `creator_info/query` pre-check, `status/fetch` polling, `FILE_UPLOAD` chunking, honouring the card-back **Privacy**, **Allow duet**, **Allow stitch**, **Allow comments** settings (all hardcoded), `is_aigc`, brand toggles, `video_cover_timestamp_ms`, `photo_cover_index`.

Known gaps relative to the official contract (fix targets for engineering, and explanations for support):

1. Photo `DIRECT_POST` omits `privacy_level`, which is "required for DIRECT_POST". Expect HTTP 400 `invalid_param` on photo posts until it is added.
2. Photo `title` is limited to 90 UTF-16 runes; suprstar sends the whole caption as `title` and `description`. Captions longer than 90 characters produce `invalid_param` on photo posts.
3. `privacy_level` is hardcoded to `SELF_ONLY` on video. Correct for an unaudited client; after audit, posts still go out private until the adapter maps `settings.privacy` to `PUBLIC_TO_EVERYONE` / `FOLLOWER_OF_CREATOR` / `MUTUAL_FOLLOW_FRIENDS` and validates against `privacy_level_options`.
4. The media URL must be on a domain/prefix verified in the TT4D app and reachable over HTTPS for up to an hour. `localhost`, private networks and tunnels with rotating hostnames fail with `url_ownership_unverified` or a later `FAILED` status.
5. Because status is never polled, a post that fails during TikTok's download/processing looks "published" in suprstar.

## Direct Post: video

Source: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post

Endpoint: `POST https://open.tiktokapis.com/v2/post/publish/video/init/`, scope `video.publish`. Headers: `Authorization: Bearer {$UserAccessToken}`, `Content-Type: application/json; charset=UTF-8`. Rate limit: "Each user access_token is limited to 6 requests per minute."

`post_info`:

| Field | Type | Required | Official note |
|---|---|---|---|
| `title` | string | No | "The video caption. Hashtags (#) and mentions (@) will be matched, or deliminated by spaces or new lines." Max 2200 UTF-16 runes |
| `privacy_level` | string | Yes | One of `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY`; must be one of the creator's `privacy_level_options` |
| `disable_duet` | bool | No | Prevents duets |
| `disable_stitch` | bool | No | Prevents stitches |
| `disable_comment` | bool | No | Prevents comments |
| `video_cover_timestamp_ms` | int32 | No | Frame used as cover |
| `brand_content_toggle` | bool | No | Paid partnership ("Branded content") |
| `brand_organic_toggle` | bool | No | Promoting own business ("Your brand") |
| `is_aigc` | bool | No | Flags AI-generated content |

`source_info`:

| Field | Required for | Note |
|---|---|---|
| `source` | always | `PULL_FROM_URL` or `FILE_UPLOAD` |
| `video_url` | `PULL_FROM_URL` | HTTPS URL on a verified domain/prefix |
| `video_size` | `FILE_UPLOAD` | Bytes |
| `chunk_size` | `FILE_UPLOAD` | Bytes per chunk |
| `total_chunk_count` | `FILE_UPLOAD` | Number of chunks |

Response `data`: `publish_id` (string, max 64 chars) and, for `FILE_UPLOAD`, `upload_url` (max 256 chars, "valid for one hour after issuance").

`FILE_UPLOAD` transfer (not implemented in suprstar): `PUT {upload_url}` per chunk with `Content-Type: video/mp4` | `video/quicktime` | `video/webm`, `Content-Length: <chunk bytes>`, `Content-Range: bytes {FIRST_BYTE}-{LAST_BYTE}/{TOTAL_BYTE_LENGTH}`; body is raw bytes. HTTP `206` means "chunk processed, more uploads pending", `201` means "all parts uploaded, posting begins".

## Direct Post: photos

Source: https://developers.tiktok.com/doc/content-posting-api-reference-photo-post

Endpoint: `POST https://open.tiktokapis.com/v2/post/publish/content/init/`, scope `video.publish` or `video.upload`. Same headers. Rate limit: "Each user access_token is limited to six requests per minute."

| Field | Required | Official note |
|---|---|---|
| `post_info.title` | No | Max 90 UTF-16 runes |
| `post_info.description` | No | Max 4000 UTF-16 runes |
| `post_info.privacy_level` | Yes for `DIRECT_POST` | Same enum as video |
| `post_info.disable_comment` | No | `DIRECT_POST` only |
| `post_info.auto_add_music` | No | `DIRECT_POST` only |
| `post_info.brand_content_toggle`, `brand_organic_toggle` | No | `DIRECT_POST` only |
| `source_info.source` | Yes | `"PULL_FROM_URL"` is "the only option allowed" for photos |
| `source_info.photo_images` | Yes | Array of up to 35 URLs (matches `maxMediaCount: 35` in suprstar's spec) |
| `source_info.photo_cover_index` | No | 0-based index |
| `post_mode` | Yes | `"DIRECT_POST"` or `"MEDIA_UPLOAD"` (draft to inbox) |
| `media_type` | Yes | `"PHOTO"` |

Response: `publish_id`. Extra error specific to photos: HTTP 400 `app_version_check_failed` (user's TikTok app "version < 31.8").

## Upload to inbox (drafts) - not used by suprstar

Source: https://developers.tiktok.com/doc/content-posting-api-reference-upload-video

`POST https://open.tiktokapis.com/v2/post/publish/inbox/video/init/`, scope `video.upload`, 6 requests/min per token; same `source_info` shape. The user must "click on inbox notifications to continue the editing flow in TikTok and complete the post". Limit: "There may be at most 5 pending shares within any 24-hour period" (`spam_risk_too_many_pending_share`). Useful fallback when Direct Post is not approved.

## Post status polling (recommended; not yet in suprstar)

Source: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status

`POST https://open.tiktokapis.com/v2/post/publish/status/fetch/`, body `{"publish_id": "<id>"}`, scope `video.upload`/`video.publish`, "Each user access_token is limited to 30 requests per minute".

`data.status` values:

| Status | Meaning |
|---|---|
| `PROCESSING_UPLOAD` | "Only available for FILE_UPLOAD. Indicates that the upload is in process" |
| `PROCESSING_DOWNLOAD` | "Only available for PULL_FROM_URL. Indicates that the download from the URL is in process" (this is where suprstar posts sit right after init) |
| `SEND_TO_USER_INBOX` | "Only available when you choose to upload content" (inbox flow) |
| `PUBLISH_COMPLETE` | Posted |
| `FAILED` | "Indicates that an error has occurred and the entire process has failed"; see `fail_reason` |

Other fields: `fail_reason` (string), `publicaly_available_post_id` (list; "post_id is returned only if the post is published for public viewership", so `SELF_ONLY` posts return none), `uploaded_bytes`, `downloaded_bytes`.

Status errors: 400 `invalid_publish_id`, 400 `token_not_authorized_for_specified_publish_id`, 401 `access_token_invalid`, 401 `scope_not_authorized`, 429 `rate_limit_exceeded`, 5xx `internal_error`.

Suggested polling: every 5-10 s for up to ~10 minutes (download window is 1 hour), staying under 30 calls/min.

## Creator info pre-check (required by TikTok UX guidelines; not yet in suprstar)

Source: https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info, https://developers.tiktok.com/doc/content-sharing-guidelines

`POST https://open.tiktokapis.com/v2/post/publish/creator_info/query/` (20 requests/min per token) returns `creator_avatar_url`, `creator_username`, `creator_nickname`, `privacy_level_options` (list), `comment_disabled`, `duet_disabled`, `stitch_disabled`, `max_video_post_duration_sec`.

Guideline: "your app must invoke the API and use the latest creator information returned to display the account's available privacy level options" and "The options listed in the UX must follow the `privacy_level_options` returned in the creator_info API." The same call returns HTTP 200 with `error.code` = `spam_risk_too_many_posts`, `spam_risk_user_banned_from_posting` or `reached_active_user_cap` before you attempt a post, which is the cleanest way to explain a refusal to the user. Commercial content disclosure toggles ("Your brand" / "Branded content", both off by default) are also required by the guidelines for audited apps.

## Media requirements

Source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide

Video:

| Property | Requirement |
|---|---|
| Container | "MP4 (recommended), WebM, MOV" |
| Codec | "H.264 (recommended), H.265, VP8, VP9" |
| Frame rate | "Minimum of 23 FPS, Maximum of 60 FPS" |
| Resolution | "Minimum of 360 pixels for both height and width, Maximum of 4096 pixels" |
| Duration | Up to 10 minutes via API (suprstar spec: `maxVideoSeconds: 600`); the creator's account limit is in `max_video_post_duration_sec` |
| File size | "4GB" maximum |
| Aspect ratio | Not specified by the API docs; suprstar offers 9:16 (default) and 1:1 |

Photos: formats "WebP, JPEG"; "Maximum of 20MB for each image"; resolution up to 1080p; up to 35 images per post. PNG is not listed: suprstar image exports should be JPEG for TikTok.

Chunking (`FILE_UPLOAD` only): "Each chunk must be at least 5 MB but no greater than 64 MB"; final chunk "up to 128 MB"; "`total_chunk_count` should be equal to `video_size` divided by `chunk_size`, rounded down"; "minimum of 1 chunk and a maximum of 1000 chunks"; "Videos with a total size less than 5 MB must be uploaded as a whole"; chunks must be sent sequentially.

`PULL_FROM_URL`: "The media URL must use 'https'"; "should not redirect to another URL"; "must remain accessible for the entire duration of the download process, which times out one hour"; domain or URL-prefix ownership verified via **Manage URL properties** on the Manage Apps page.

## Text limits

Source: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post, https://developers.tiktok.com/doc/content-posting-api-reference-photo-post

- Video `title`: 2200 UTF-16 runes; hashtags `#tag` and mentions `@user` are parsed when separated by spaces or new lines. suprstar's `captionMaxLength: 2200` matches.
- Photo `title`: 90; photo `description`: 4000.
- No documented hashtag count limit; suprstar's `hashtagLimit: 30` is an app-side choice.

## Privacy / audience options

Source: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post, https://developers.tiktok.com/doc/content-sharing-guidelines

`privacy_level` enum: `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY`. A private TikTok account does not offer `PUBLIC_TO_EVERYONE`; sending a value not in `privacy_level_options` yields HTTP 403 `privacy_level_option_mismatch`. Unaudited clients may only send `SELF_ONLY` (403 `unaudited_client_can_only_post_to_private_accounts` otherwise, and the account itself must be private). Interaction toggles: `disable_duet`, `disable_stitch`, `disable_comment` (video), `disable_comment` (photo).

Mapping suprstar card-back **Privacy** to TikTok (once implemented): `public` -> `PUBLIC_TO_EVERYONE`, `friends` -> `MUTUAL_FOLLOW_FRIENDS`, `private` -> `SELF_ONLY`, `unlisted` -> no equivalent (use `SELF_ONLY`).

## Known constraints checklist

- Unaudited client: `SELF_ONLY` only, 5 posting users per 24 h, accounts must be private.
- ~15 posts per creator per 24 h (audited or not): `spam_risk_too_many_posts`.
- 6 init calls per minute per user token.
- Media URL host must be verified and HTTPS; download window 1 h.
- `publish_id` is not a public post id; a public post id only appears in `status/fetch` for public posts.
- Photo posts need `privacy_level` and a `title` of at most 90 runes.
