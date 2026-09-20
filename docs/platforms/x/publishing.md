---
platform: x
topic: publishing
sources:
  - https://docs.x.com/x-api/posts/creation-of-a-post
  - https://docs.x.com/x-api/posts/delete-post
  - https://docs.x.com/x-api/media/introduction
  - https://docs.x.com/x-api/media/upload-media
  - https://docs.x.com/x-api/media/media-upload-initialize
  - https://docs.x.com/x-api/media/media-upload-append
  - https://docs.x.com/x-api/media/media-upload-finalize
  - https://docs.x.com/x-api/media/media-upload-status
  - https://docs.x.com/x-api/media/quickstart/media-upload-chunked
  - https://docs.x.com/x-api/media/quickstart/best-practices
  - https://docs.x.com/x-api/media/metadata-create
  - https://docs.x.com/resources/fundamentals/counting-characters
  - https://docs.x.com/x-api/posts/post-lookup-by-post-ids
  - https://docs.x.com/x-api/users/user-lookup-me
  - https://docs.x.com/changelog
fetched: 2026-09-19
---

# X — Publishing (POST /2/tweets + media upload v2)

suprstar has no X adapter yet (see `overview.md`). This is the reference for `publish()` and `fetchMetrics()` once it exists.

## Publish sequence

1. For each media asset: upload to get a `media_id` (simple upload for images ≤ 5 MB; chunked upload for video and GIFs).
2. For video: poll `GET /2/media/upload?command=STATUS&media_id=...` until `processing_info.state` is `succeeded` (or absent).
3. Optionally `POST /2/media/metadata` to attach alt text.
4. `POST /2/tweets` with `text` and `media.media_ids`.
5. Response `data.id` is the Post ID; public URL is `https://x.com/<username>/status/<id>`.

All calls use `Authorization: Bearer <user OAuth 2.0 access token>` (scopes in `oauth.md`). Media IDs are bound to the user who uploaded them (unless `additional_owners` is set) and expire — see below.

## POST /2/tweets

Source: https://docs.x.com/x-api/posts/creation-of-a-post

- URL: `POST https://api.x.com/2/tweets`, JSON body.
- Auth: "OAuth2UserToken with scopes: `users.read`, `tweet.write`, `tweet.read`" or OAuth 1.0a "UserToken".
- Success: HTTP **201**, body `{"data": {"id": "...", "text": "...", "edit_history_post_ids": [...]}}`.

Request body fields (exact names, doc wording quoted):

| Field | Type | Notes |
|---|---|---|
| `text` | string | "Text of the tweet. Required unless media is provided" |
| `media.media_ids` | string[] | 1–4 items. Up to 4 images, or 1 video, or 1 GIF (the "4 images or 1 video/GIF" mix rule is standard X behaviour; the reference only states the 1–4 array bound — mixing is unverified) |
| `media.tagged_user_ids` | string[] | user IDs to tag in the media |
| `media.title`, `media.description`, `media.embeddable`, `media.preview_media_id`, `media.call_to_actions` | | additional media object fields listed in the schema |
| `reply.in_reply_to_tweet_id` | string | required inside `reply`; also `auto_populate_reply_metadata`, `exclude_reply_user_ids` |
| `quote_tweet_id` | string | "Quote-posting...requires an Enterprise plan" (changelog 2026-04-16: Quote-Posts "removed from all self-serve tiers") |
| `poll.options` / `poll.duration_minutes` | | 2–4 options; duration 5–10080 minutes |
| `reply_settings` | enum | `following`, `mentionedUsers`, `subscribers`, `verified` (omit for "everyone") |
| `for_super_followers_only` | boolean | "Restrict tweet to super followers" |
| `geo.place_id` | string | |
| `community_id` | string | "Community to post the tweet to" |
| `edit_options.previous_post_id` | string | edit an existing post |
| `made_with_ai` | boolean | "Disclose that the tweet contains AI-generated media" |
| `paid_partnership` | boolean | "Disclose that the tweet is a paid partnership" (added 2026-06-03 per changelog) |
| `nullcast` | boolean | "If true, the tweet is not shown in the public timeline" (Ads use) |
| `share_with_followers`, `card_uri`, `direct_message_deep_link` | | not needed by suprstar |

Minimal suprstar payload:

```json
{ "text": "<caption>", "media": { "media_ids": ["1234567890"] } }
```

### Restrictions that matter (date-sensitive)

- Programmatic **replies** are restricted since 2026-02-23: only permitted when "original Post's author has summoned the replier" (changelog). Regular top-level posts are unaffected.
- **Quote posts** are Enterprise-only on self-serve plans since 2026-04-16.
- A post whose `text` contains a URL is billed at **$0.20** instead of $0.015 (pricing page, 2026-04-16 update). Consider warning users when the caption contains a link.
- Rate limits: 100 posts / 15 min per user; 10,000 / 24 h per app (rate-limits page).

### Privacy / audience

X has no per-post privacy flag equivalent to TikTok `privacy_level` or YouTube `privacyStatus`. Visibility follows the account (public vs protected). The only per-post audience controls are `reply_settings` (who may reply), `for_super_followers_only`, and `community_id`. suprstar's `settings.privacy` (`public|private|unlisted|friends`) has no X mapping; an adapter should ignore it (or refuse non-`public`) rather than silently post.

### Duplicate content

X rejects a post whose text is identical to a recent post from the same account. The historically observed response is HTTP **403** with `detail: "You are not allowed to create a Tweet with duplicate content."` (legacy code **187** "Status is a duplicate"). This string is **not on the fetched docs.x.com pages** — unverified verbatim, but the behaviour is long-standing. Vary the text (or the media) to publish again. Note suprstar's scheduler retries a failed job by re-sending the same caption; a duplicate rejection will repeat until the caption changes.

## Text limits

Source: https://docs.x.com/resources/fundamentals/counting-characters

- Standard limit: "up to 280 characters", **weighted**:
  - 1 point: "Latin, punctuation, common symbols"
  - 2 points: "Emojis", "CJK (Chinese, Japanese, Korean)", and other Unicode ranges by default
  - "All emojis count as 2 characters, regardless of complexity."
- URLs: "All URLs are wrapped with t.co shortener and count as 23 characters, regardless of the original length."
- Auto-populated @mentions at the start of a reply don't count; manually typed @mentions and hashtags count normally.
- "Attached media (via official clients) counts as 0 characters".
- The docs recommend the "official twitter-text library" for counting.
- Longer posts (4,000 / 25,000 characters) for X Premium subscribers are **not mentioned** on the counting page — unverified; assume 280 for API-created posts unless verified per account.
- No documented hashtag or mention count limit; they simply consume characters. Suggested `PLATFORM_SPECS.x`: `captionMaxLength: 280`, `hashtagLimit` advisory only.

## Media upload — simple (images)

Source: https://docs.x.com/x-api/media/upload-media , https://docs.x.com/x-api/media/introduction

`POST https://api.x.com/2/media/upload` — "for images and small files only"; "Use chunked upload for all videos".

- Auth: OAuth2UserToken scope `media.write` ("Upload media, such as photos and videos, on your behalf") or OAuth 1.0a UserToken.
- Body (multipart/form-data, or JSON with base64):
  - `media` — "The media file to upload: base64-encoded in JSON bodies, raw bytes in multipart bodies"
  - `media_category` — required; enum `tweet_image`, `tweet_video`, `tweet_gif`, `dm_image`, `dm_video`, `dm_gif`, `subtitles` (use `tweet_image` for suprstar posts)
  - `additional_owners` — "Comma-separated list of user IDs who can use this media" (optional)
- Response `data`: `id` ("Unique identifier of the media"), `media_key`, `size` (bytes), `expires_after_secs` ("Seconds until the upload session expires"), `image.w` / `image.h`.
- Rate limit: 500 / 15 min per user; 50,000 / 24 h per app.

Use `data.id` as the `media_ids` value. `media_key` is not accepted by `POST /2/tweets`.

## Media upload — chunked (video, GIF, large files)

Sources: https://docs.x.com/x-api/media/quickstart/media-upload-chunked , https://docs.x.com/x-api/media/media-upload-initialize , https://docs.x.com/x-api/media/media-upload-append , https://docs.x.com/x-api/media/media-upload-finalize , https://docs.x.com/x-api/media/media-upload-status

The v2 flow uses dedicated paths; the quickstart says to "Use dedicated endpoint paths; avoid legacy `command=` parameters for INIT/APPEND/FINALIZE" (only STATUS keeps `command=STATUS`).

### 1. INIT — `POST https://api.x.com/2/media/upload/initialize` (JSON)

| Field | Values |
|---|---|
| `media_type` | `video/mp4`, `video/webm`, `video/mp2t`, `video/quicktime`, `image/jpeg`, `image/gif`, `image/bmp`, `image/png`, `image/webp`, `image/pjpeg`, `image/tiff`, `text/srt`, `text/vtt`, `model/gltf-binary`, `model/vnd.usdz+zip` |
| `media_category` | `amplify_video`, `tweet_gif`, `tweet_image`, `tweet_video`, `dm_gif`, `dm_image`, `dm_video`, `subtitles` — use **`tweet_video`** for a suprstar video post, `tweet_gif` for GIFs |
| `total_bytes` | integer, schema max 17,179,869,184 |
| `shared` | boolean (optional) |
| `additional_owners` | array of user IDs (optional) |

Response `data`: `id` (the media_id / upload session), `media_key`, `expires_after_secs`. The quickstart states media expiry as "86,400 seconds (24 hours) after initialization" — attach the media to a post before then.

Best-practices warning: "Choose the correct category to avoid upload success but Post creation failure." Uploading with a `dm_*` category and then using the id in `POST /2/tweets` fails at post creation.

### 2. APPEND — `POST https://api.x.com/2/media/upload/{id}/append` (multipart/form-data)

- `media` — the binary chunk (required)
- `segment_index` — integer 0–999 (required), 0-based, sequential
- Chunk size: quickstart says "Max chunk size: 5 MB (server maximum is 8 MB)"
- Response 200: `data.expires_at` (epoch seconds when the upload session expires)

### 3. FINALIZE — `POST https://api.x.com/2/media/upload/{id}/finalize`

Response `data`: `id`, `media_key`, `size`, `expires_after_secs`, `video.video_type`, and — for video — `processing_info` with `state` and `check_after_secs`. "If processing completes without `processing_info`, the media is immediately ready for use."

### 4. STATUS — `GET https://api.x.com/2/media/upload?command=STATUS&media_id={id}`

Response `data.processing_info`:

- `state`: `pending` → `in_progress` → `succeeded` or `failed`
- `check_after_secs`: "Polling interval recommendation" — sleep this long before polling again
- `progress_percent`
- on failure an `error` object with `code`, `name`, `message` (standard shape; field names beyond `code`/`message` unverified)

Do not call `POST /2/tweets` until `state` is `succeeded`; attaching a still-processing video fails post creation. A suprstar adapter should poll with `check_after_secs` (typically 1–5 s) and give up after a few minutes with a clear "post stuck processing" error rather than the 20 × 1 s loop used by the Instagram adapter.

The quickstart also notes: "Media can still be rejected when attached to a Post if it exceeds the posting user's limits."

### Documented error example

`403 Forbidden` — `"This user is not allowed to post a video longer than 20 minutes."` (non-Premium account exceeding the default `tweet_video` duration).

## Alt text — `POST https://api.x.com/2/media/metadata`

Source: https://docs.x.com/x-api/media/metadata-create

Body: `{"id": "<media_id>", "metadata": {"alt_text": {"text": "..."}}}`; `id` must match `^[0-9]{1,19}$`; `alt_text.text` "maxLength: 1000". Other optional metadata: `allow_download_status.allow_download`, `found_media_origin`, `sticker_info`, `shared_info`. Scope `media.write`. Response 200 `data.id`, `data.associated_metadata`. Rate limit 500 / 15 min per user. Call it after upload/processing and before `POST /2/tweets`.

## Media requirements

Source: https://docs.x.com/x-api/media/quickstart/best-practices , https://docs.x.com/changelog (2026-09-01)

Images:
- Formats: "JPG, PNG, GIF, WEBP"
- "Image size: <= 5 MB"

Animated GIF (`tweet_gif`):
- "Animated GIF size: <= 15 MB"
- Resolution "<= 1280x1080 (width x height)"
- Frames "<= 350"; total pixels "<= 300 million (width * height * num_frames)"

Video (`tweet_video`):
- Container: MP4 (`video/mp4`) or MOV (`video/quicktime`); WebM and MPEG-TS are accepted `media_type` values
- Video codec: "H264 High Profile" recommended; "Only YUV 4:2:0 is supported"; progressive scan (no interlacing); pixel aspect ratio "must have 1:1"
- Audio: "AAC LC" (High-Efficiency AAC is not supported)
- Frame rate: "60 FPS or less"
- Dimensions: between "32x32 and 1280x1024" (recommended 1280x720 landscape, 720x1280 portrait, 720x720 square; Premium accounts get 1080p playback)
- Aspect ratio: "between 1:3 and 3:1"
- Duration / size — depend on the **posting user's** Premium/verified status, not the developer plan:
  - Default accounts: "0.5 seconds–20 minutes", "8 GB"
  - Premium/verified: "0.5 seconds–125 minutes", "16 GB"
  - (the older 140 s / 512 MB limits now apply to `dm_video` only: "140 s / 512 MB · Premium: 10 min / 1 GB")

suprstar's `FORMAT_SPECS` outputs (1080x1080, 1080x1350, 1080x1920, 1920x1080, 1200x628) all fit the 1:3–3:1 aspect range; the 1920x1080 export exceeds the "1280x1024" guidance in the best-practices page (X re-encodes; whether it rejects is unverified — Premium 1080p support suggests it accepts). Safe defaults: `landscape_16_9` at 1280x720 and `portrait_9_16` at 720x1280.

## Delete — `DELETE https://api.x.com/2/tweets/{id}`

Source: https://docs.x.com/x-api/posts/delete-post

Scopes `tweet.write`, `tweet.read`, `users.read`. Response `{"data": {"deleted": true}}`. Rate limit 50 / 15 min per user.

## Metrics (`fetchMetrics`)

Sources: https://docs.x.com/x-api/posts/post-lookup-by-post-ids , https://docs.x.com/x-api/users/user-lookup-me

Post-level: `GET https://api.x.com/2/tweets?ids=<up to 100>&tweet.fields=public_metrics,non_public_metrics,organic_metrics`

- `public_metrics`: `repost_count`, `reply_count`, `like_count`, `quote_count`, `bookmark_count`, `impression_count` (the v2 docs now say `repost_count`; older responses used `retweet_count` — an adapter should read both).
- `non_public_metrics` ("Nonpublic engagement metrics for the Post at the time of the request") and `organic_metrics` require user-context auth (`tweet.read`, `users.read`) and the requesting user must own the post. They historically include `impression_count`, `url_link_clicks`, `user_profile_clicks`, but those field names are not in the fetched schema — unverified.
- Rate limit: 5,000 / 15 min per user; each returned post is a billed Post read ($0.005, or $0.001 as an Owned Read).

Account-level: `GET https://api.x.com/2/users/me?user.fields=public_metrics` → `followers_count`, `following_count`, `post_count`, `listed_count`, `like_count`. 75 / 15 min per user.

There is no daily time-series analytics endpoint in v2 for a suprstar `MetricSnapshot`; an adapter must snapshot the counters daily itself. Post-level `impression_count` maps to `impressions`/`views`; `like_count` → `likes`; `reply_count` → `comments`; `repost_count + quote_count` → `shares`; `bookmark_count` → `saves`; `followers_count` → `followers`. `reach` and `clicks` have no public equivalent.

## Legacy v1.1 media upload

`POST https://upload.twitter.com/1.1/media/upload.json` (the `command=INIT|APPEND|FINALIZE|STATUS` style) still appears on developer.x.com, and the v2 endpoints launched 2025-01-16 ("New X API v2 Media Upload endpoints", changelog). No deprecation date for v1.1 media upload is published on docs.x.com as of this pull (unverified). New code should use the v2 paths only.

## Constraints checklist for the adapter

- Requires `media.write` in the granted scopes — a token obtained before this scope was added to the card back will fail every upload with 403 until the user reconnects.
- One `POST /2/tweets` per post; no carousel concept — multiple images go in one post via `media_ids` (max 4); a video cannot be combined with images (unverified but standard).
- Media must be uploaded by the same user token that creates the post.
- Media ids expire ~24 h after INIT; do not pre-upload for scheduled posts far in the future.
- Every successful publish costs credits; a duplicate rejection or a rate-limit 429 does not (unverified — pricing page does not state whether failed requests are billed).
