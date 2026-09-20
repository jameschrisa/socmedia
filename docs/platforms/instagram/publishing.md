---
platform: instagram
topic: publishing
sources:
  - https://developers.facebook.com/docs/instagram-platform/content-publishing
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/insights
  - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes
fetched: 2026-09-19
---

# Instagram content publishing and insights

## How suprstar publishes

Source: `server/src/platforms/instagram.ts` (app code).

1. Resolve the IG user id: `credentials.extra.igUserId` if the card-back **Instagram business account ID** is set, else `GET /me/accounts?fields=instagram_business_account,name` and take the first Page with an `instagram_business_account`.
2. `POST https://graph.facebook.com/v21.0/{ig-user-id}/media` (form-encoded) with `caption`, `access_token` and either `image_url={absolute media URL}` or `media_type=REELS&video_url={absolute media URL}`. Only `media[0]` is used; extra media files are ignored (no carousel).
3. For video only: poll `GET /{container-id}?fields=status_code` once per second, at most 20 times (about 20 s). `FINISHED` continues; `ERROR` throws `Instagram media container failed to process.`; anything else after 20 polls throws `Timed out waiting for Instagram media container to finish processing.` Images are published without polling.
4. `POST /{ig-user-id}/media_publish` with `creation_id={container-id}`.
5. Returns `externalId = {ig-media-id}` and `externalUrl = https://www.instagram.com/p/{ig-media-id}/`. That URL is not a valid permalink (Instagram permalinks use the media `shortcode`, e.g. `https://www.instagram.com/p/{shortcode}/`, and Reels use `/reel/{shortcode}/`); the correct link is the `permalink` field of `GET /{ig-media-id}?fields=permalink`, which the adapter does not read. See "Post published but link 404s" in `troubleshooting.md`.

Settings on the card back that the adapter does **not** send: Privacy (Instagram API posts are always public to the account's audience), Allow comments, Share reels to feed (`share_to_feed`), Post hashtags as first comment, Default format. Caption is the post caption after `effectiveCaption(post, target)`.

Media URLs are `toAbsoluteUrl(asset.url)`, i.e. served by the suprstar server. Meta states it "will cURL the image using the URL that you specify so the image must be on a public server"; a `localhost`, private-network or auth-protected suprstar instance cannot publish to Instagram in Live mode.

## Endpoints

Source: https://developers.facebook.com/docs/instagram-platform/content-publishing

| Step | Endpoint |
|---|---|
| Create container | `POST /{ig-user-id}/media` |
| Upload video bytes (resumable, optional) | `POST https://rupload.facebook.com/ig-api-upload/{ig-container-id}` with `upload_type=resumable` on the container |
| Check container | `GET /{ig-container-id}?fields=status_code` |
| Publish | `POST /{ig-user-id}/media_publish` with `creation_id` |
| Quota | `GET /{ig-user-id}/content_publishing_limit` |

Required permissions (Facebook Login): `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, plus `ads_management` and `ads_read` "if the user has a Page role via Business Manager".

## `POST /{ig-user-id}/media` parameters

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media

| Parameter | Applies to | Notes (quoted where Meta gives exact text) |
|---|---|---|
| `image_url` | images | "The path to the image. We will cURL the image using the URL that you specify so the image must be on a public server." |
| `video_url` | reels, stories, carousel video items | "Path to the video. We cURL the video using the passed-in URL, so it must be on a public server." |
| `media_type` | required for `CAROUSEL`, `REELS`, `STORIES`; omit for a single image | suprstar sends `REELS` for videos, nothing for images |
| `caption` | image, video, carousel | "Can include hashtags and usernames." Max 2200 characters, 30 hashtags, 20 @tags |
| `share_to_feed` | reels | `true`: appears in Feed and Reels tabs; `false`: Reels tab only. Not sent by suprstar |
| `user_tags` | images | array of `{username, x, y}`; x/y are floats "within 0.0-1.0 range" |
| `location_id` | image, video | "The ID of a Page associated with a location" |
| `cover_url` | reels | JPEG cover image, 8 MB max, sRGB, 9:16 recommended |
| `thumb_offset` | video/reels | "Location, in milliseconds, of the video or reel frame to be used as the cover thumbnail image. The default value is 0." |
| `children` | carousel | "An array of up to 10 container IDs" |
| `is_carousel_item` | carousel children | set `true` on each child container |
| `collaborators` | any | "A list of up to 3 instagram usernames" |
| `product_tags` | shopping | up to 5 products |
| `audio_name` | reels | name of the audio |
| `upload_type` | video | `resumable` to upload bytes via rupload instead of `video_url` |
| `alt_text` | images only | "up to 1000 character" (added March 24, 2025; not supported on reels/stories) |
| `is_ai_generated`, `is_paid_partnership`, `branded_content_sponsor_ids` (max 2) | any | disclosure flags |

Response: `{"id": "<IG_CONTAINER_ID>"}`.

## Container status and polling

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container and https://developers.facebook.com/docs/instagram-platform/content-publishing

`GET /{ig-container-id}?fields=status_code,status`

| `status_code` | Meaning |
|---|---|
| `EXPIRED` | "Container wasn't published within 24 hours" |
| `ERROR` | "Publishing process failed"; the `status` field then "contains an error subcode rather than descriptive text" (map it with `errors.md`, e.g. `2207026`) |
| `FINISHED` | "Container and media ready for publication" |
| `IN_PROGRESS` | still processing |
| `PUBLISHED` | media object already published |

Meta's polling guidance: "Query a container's status once per minute, for no more than 5 minutes." suprstar polls every 1 s for 20 s, so a Reel that Meta needs 30 s to 5 min to transcode will hit `Timed out waiting for Instagram media container to finish processing.` even though the container is fine. The container remains valid for 24 h; retrying the publish in suprstar creates a **new** container rather than re-polling the old one.

Publishing before `FINISHED` returns code `9007`, subcode `2207027`, "The media is not ready for publishing...".

Other container rules: "Containers expire after 24 hours"; "An Instagram account can only create 400 containers within a rolling 24 hour period".

## `POST /{ig-user-id}/media_publish`

Source: https://developers.facebook.com/docs/instagram-platform/content-publishing

Parameters: `creation_id` (the container id), `access_token`. Response: `{"id": "<IG_MEDIA_ID>"}`. The returned id is the IG Media id; read `permalink` from it for the public URL.

## Media requirements

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media and https://developers.facebook.com/docs/instagram-platform/content-publishing

### Images (feed)

- Format: JPEG only ("JPEG is the only image format supported"; extended formats MPO and JPS unsupported). PNG/WebP/HEIC uploads fail with code `36001`, subcode `2207005`, "The image format {current-format} is not supported."
- File size: 8 MB maximum (error `36000` / `2207004` "The image is too large to download...").
- Aspect ratio: 4:5 to 1.91:1 (error `36003` / `2207009` "The submitted image with aspect ratio..."). A 9:16 image cannot be a feed post; use `STORIES` or crop.
- Width: minimum 320 px, maximum 1440 px (wider images are scaled).
- Color space: sRGB.

suprstar formats vs these rules: `square` (1:1), `portrait_4_5` (4:5), `landscape_1_91` (1.91:1) are valid feed images; `portrait_9_16` is only valid for Reels/Stories, so a 9:16 **image** exported for Instagram will be rejected on publish.

### Reels (what suprstar sends for any video)

- Container: MOV or MP4; "no edit lists, moov atom at the front of the file".
- Video codec: HEVC or H.264; "progressive scan, closed GOP, 4:2:0 chroma subsampling".
- Audio codec: AAC, 48 kHz sample rate maximum, 1-2 channels; 128 kbps audio bitrate.
- Frame rate: 23-60 FPS.
- Resolution: maximum 1920 horizontal pixels.
- Video bitrate: 25 Mbps maximum (VBR).
- Aspect ratio: "between 0.01:1 and 10:1 but we recommend 9:16".
- Duration: "15 mins maximum, 3 seconds minimum".
- File size: 300 MB maximum.
- Cover: `cover_url` JPEG 8 MB, or `thumb_offset` in ms.

A 16:9 or 1:1 video is accepted as a Reel but displayed letterboxed; suprstar's `maxVideoSeconds: 900` matches the 15-minute cap. Unsupported container/codec returns code `352`, subcode `2207026`, "The video format is not supported."

### Stories (not used by suprstar)

Images: JPEG, 8 MB, 9:16 recommended. Videos: MOV/MP4, HEVC/H.264, AAC 48 kHz, 23-60 FPS, aspect "between 0.1:1 and 10:1", 25 Mbps, 128 kbps audio, "60 seconds maximum, 3 seconds minimum", 100 MB maximum. Stories expire after 24 h; stickers are not supported.

### Carousels (not used by suprstar)

2-10 items (error `100` / `2207028` "Your post won't work as a carousel..."), images and videos mixed, Reels cannot be items, "All cropped based on the first image", default 1:1; captions and location tags on child items are not supported. Create each child with `is_carousel_item=true`, then a parent with `media_type=CAROUSEL&children=id1,id2,...`, then publish the parent. Counts as one post toward the quota.

## Text limits

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media and error-codes reference

- Caption: 2200 characters max (`36004` / `2207010` "The submitted image's caption was..." when exceeded).
- Hashtags: 30 max in the caption.
- @mentions: 20 max (`100` / `2207040` "Cannot use more than {max-tag-count} tags per...").
- `alt_text`: 1000 characters (images only).

## Privacy and audience

Source: https://developers.facebook.com/docs/instagram-platform/content-publishing

The publishing API has no privacy parameter; published media is visible according to the Instagram account's own privacy setting. Reels have `share_to_feed`. Comments cannot be disabled at publish time through this endpoint (the IG Media node exposes `is_comment_enabled` for later updates, not verified for update support here). suprstar's card-back Privacy and Allow comments settings therefore have no effect on Instagram.

## Publishing quota

Source: https://developers.facebook.com/docs/instagram-platform/content-publishing and https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit

- Guide: "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period." Reference: `quota_total` "currently `50`", `quota_duration` "currently `86400`". Read the live value:

```
GET /{ig-user-id}/content_publishing_limit?fields=quota_usage,config&since={unix ts within 24 h}
→ {"data":[{"quota_usage":2,"config":{"quota_total":50,"quota_duration":86400}}]}
```

- Exceeding it: code `9`, subcode `2207042`, "You reached maximum number of posts that is allowed..."; wait for the window to roll.
- Container creation cap: 400 per rolling 24 h (each failed suprstar attempt consumes one).

## Known constraints specific to suprstar

- Public URL requirement: media must be fetchable by Meta's crawler. Code `9004` / `2207052` "The media could not be fetched from this uri:" means the suprstar media URL was unreachable, redirected, required auth, or returned the wrong `Content-Type`.
- Only the first media file is published; carousels and Stories are not supported by the adapter.
- 20-second polling window versus Meta's 5-minute guidance (see above).
- `externalUrl` is not a permalink.
- Insights are requested but discarded (`fetchMetrics` returns `[]`), so the Metrics view is always empty for Live Instagram connections; only Sandbox produces numbers.
- Graph `v21.0` is hardcoded; available until January 21, 2027.

## Insights (for the metrics feature)

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights and https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/insights

Account: `GET /{ig-user-id}/insights?metric=...&period=day&metric_type=total_value[&since&until]`. Required: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`. Interaction metrics: `accounts_engaged`, `comments`, `follows_and_unfollows`, `likes`, `profile_links_taps`, `reach`, `replies`, `reposts`, `saves`, `shares`, `total_interactions`, `views`; demographic metrics `engaged_audience_demographics`, `follower_demographics` with `period=lifetime` and `timeframe`. `follower_count` and `online_followers` "are not available on Instagram business or creator accounts with fewer than 100 followers". Data "may be delayed up to 48 hours".

Deprecation: `impressions` is "Deprecated for v22.0+" and sunset for all versions on April 21, 2025; replaced by `views` with `metric_type=total_value` and breakdowns `follower_type`, `media_product_type`. suprstar's `fetchMetrics` still requests `impressions,reach,follower_count`, which returns an `OAuthException`/code `100` invalid-metric error on current versions (the adapter ignores the response).

Media: `GET /{ig-media-id}/insights?metric=...`. FEED: `comments`, `likes`, `views`, `reach`, `saved`, `shares`, `total_interactions`, `profile_visits`, `follows`; REELS adds `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`; STORY: `views`, `reach`, `shares`, `replies`, `navigation`, `link_clicks`. "Story media metrics are only available for 24 hours". Stories with fewer than 5 views return error code `10` "Not enough viewers for the media to show insights". `impressions` on media "created after July 2, 2024" is deprecated.

## Media fields to read back

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media

`GET /{ig-media-id}?fields=id,permalink,shortcode,media_type,media_product_type,media_url,thumbnail_url,timestamp,like_count,comments_count,is_comment_enabled`. `permalink` is the "Permanent URL to the media" (not available for photos inside albums); `media_url` is "Omitted from responses if the media contains copyrighted material". Requires `instagram_basic` and `pages_read_engagement`.
