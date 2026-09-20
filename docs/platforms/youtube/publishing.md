---
platform: youtube
topic: publishing
sources:
  - https://developers.google.com/youtube/v3/docs/videos/insert
  - https://developers.google.com/youtube/v3/docs/videos
  - https://developers.google.com/youtube/v3/docs/videos/list
  - https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
  - https://developers.google.com/youtube/v3/guides/implementation/videos
  - https://developers.google.com/youtube/v3/guides/uploading_a_video
  - https://developers.google.com/youtube/v3/determine_quota_cost
  - https://developers.google.com/youtube/v3/revision_history
  - https://developers.google.com/youtube/analytics/reference/reports/query
  - https://developers.google.com/youtube/analytics/channel_reports
fetched: 2026-09-19
---

# YouTube: publishing videos from suprstar

## How suprstar uploads

Source: https://developers.google.com/youtube/v3/docs/videos/insert ; app code `server/src/platforms/youtube.ts`

Request built by the adapter:

```
POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status
Authorization: Bearer <accessToken>
Content-Type: multipart/related; boundary=<boundary>
Content-Length: <bytes>

--<boundary>
Content-Type: application/json; charset=UTF-8

{"snippet":{"title":"...","description":"...","categoryId":"22"},
 "status":{"privacyStatus":"public|private|unlisted","selfDeclaredMadeForKids":false}}
--<boundary>
Content-Type: video/mp4

<raw video bytes>
--<boundary>--
```

Mapping from the app:

| Field | Value |
|---|---|
| `snippet.title` | `target.title` or `post.title`, sliced to 100 chars, or `"Untitled"` |
| `snippet.description` | `effectiveCaption(post, target)` (caption, hashtags appended per settings) |
| `snippet.categoryId` | card-back **Category** or `"22"` (People & Blogs) |
| `status.privacyStatus` | card-back **Privacy**: `public`, `private`, `unlisted`; `friends` is mapped to `unlisted` |
| `status.selfDeclaredMadeForKids` | card-back **Made for kids** |
| video part `Content-Type` | asset `mimeType` or `video/mp4` |

Behaviour to remember when diagnosing:

- The entire file is read into memory (`fs.readFileSync`) and sent in one request. There is no resumable session, no chunking, no retry and no exponential backoff. A network blip or a large file simply fails with whatever status Google (or the Node fetch) returns.
- Success is `HTTP 200` with a `video` resource; suprstar stores `externalId = data.id` and `externalUrl = https://youtu.be/<id>`.
- suprstar does **not** poll `processingDetails` afterwards. A post shows as "published" as soon as the upload request returns, even though "the video will not be visible on YouTube until it has been processed."
- `notifySubscribers` is not set, so it defaults to `true`.
- Tags, `publishAt`, `embeddable`, `license`, `containsSyntheticMedia`, thumbnails and localisations are not sent.
- Only one video per post; images are rejected with the app error "YouTube requires a video file to publish."

## videos.insert reference

Source: https://developers.google.com/youtube/v3/docs/videos/insert

- Method: `POST https://www.googleapis.com/upload/youtube/v3/videos`
- Quota: "100 calls per day" and "a quota cost of 1 unit in the Video Uploads quota bucket" (model in force since 2026-06-01; see `overview.md`).
- Upload limits: maximum file size **256GB**; accepted MIME types `video/*`, `application/octet-stream`.
- Required query parameter `part` (what to set/return): suprstar uses `snippet,status`.
- Optional: `notifySubscribers` (default true), `onBehalfOfContentOwner`, `onBehalfOfContentOwnerChannel` (content-partner only).
- Accepted scopes: `youtube.upload`, `youtube`, `youtubepartner`, `youtube.force-ssl`.
- Settable body properties: `snippet.title`, `snippet.description`, `snippet.tags[]`, `snippet.categoryId`, `snippet.defaultLanguage`, `localizations.*`, `status.embeddable`, `status.license`, `status.privacyStatus`, `status.publicStatsViewable`, `status.publishAt`, `status.selfDeclaredMadeForKids`, `status.containsSyntheticMedia`, `recordingDetails.recordingDate`.

## Multipart vs resumable upload

Source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

suprstar uses `uploadType=multipart`. Google's recommended path for anything that can fail mid-transfer is the resumable protocol:

1. `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with headers `Authorization`, `Content-Type: application/json; charset=UTF-8`, `Content-Length` (metadata size), `X-Upload-Content-Length` (video bytes), `X-Upload-Content-Type` (e.g. `video/*`). Response `200` with a `Location` header holding the session URI.
2. `PUT <session URI>` with `Content-Length`, `Content-Type` and the bytes. Success is `201 Created` with the video resource.
3. Interrupted: send an empty `PUT` with `Content-Range: bytes */TOTAL`; a `308 Resume Incomplete` reply carries `Range: bytes=0-N` for what was received; resume with `Content-Range: bytes FIRST-LAST/TOTAL`.
4. Chunking: each chunk "a multiple of 256 KB" except the last, all chunks the same size; non-final chunks return `308`.
5. "Use an exponential backoff strategy when resuming uploads after receiving" HTTP `500`, `502`, `503` or `504`. A `404` on the session URI means it expired; start over.

Moving suprstar to this protocol is the fix for "publish fails immediately" on large files or flaky networks.

## Media requirements

Sources: https://developers.google.com/youtube/v3/docs/videos/insert, https://developers.google.com/youtube/v3/docs/videos

Verified on developers.google.com:

- Size: up to 256GB per `videos.insert`.
- MIME: any `video/*` or `application/octet-stream`.
- Upload failure reasons YouTube reports afterwards (`status.failureReason`): `codec`, `conversion`, `emptyFile`, `invalidFile`, `tooSmall`, `uploadAborted`.
- Rejection reasons (`status.rejectionReason`): `claim`, `copyright`, `duplicate`, `inappropriate`, `legal`, `length`, `termsOfUse`, `trademark`, `uploaderAccountClosed`, `uploaderAccountSuspended`.

Not on the developer site (YouTube Help pages, **unverified** here): the container/codec list (MP4 with H.264 + AAC is the usual recommendation), the default 15-minute limit for unverified channels versus 12 hours / 256GB after phone verification, and the Shorts rule (vertical or square, up to 3 minutes since October 2024). suprstar's `maxVideoSeconds` of 43200 assumes a phone-verified channel; an unverified channel returns `rejectionReason: length` or a `400 uploadLimitExceeded`-style error for long videos.

Shorts: there is no API flag. YouTube classifies a video as a Short from its dimensions and duration; suprstar's `portrait_9_16` format at 1080x1920 with a short duration will land in Shorts. The Data API revision history (2025-03-26) only documents the Shorts view-count change. Treat "how Shorts are detected" as **unverified** on developers.google.com.

## Text limits

Source: https://developers.google.com/youtube/v3/docs/videos

- `snippet.title`: maximum 100 characters; cannot contain `<` or `>`. Empty title returns `400 invalidTitle` ("The request metadata specifies an invalid or empty video title"). suprstar slices to 100 and falls back to "Untitled".
- `snippet.description`: maximum 5000 **bytes** (not characters; multibyte text counts more); cannot contain `<` or `>`. Violation returns `400 invalidDescription`. suprstar's `captionMaxLength` is 5000 characters, so a caption near the limit with emoji or non-Latin text can exceed 5000 bytes.
- `snippet.tags`: 500 characters total including separators; not sent by suprstar.
- Hashtags: no API-level limit documented on developers.google.com; suprstar caps at 15. YouTube Help states over 60 hashtags cause all to be ignored (**unverified**).
- Mentions: no API syntax for tagging channels in descriptions beyond plain `@handle` text (**unverified**).
- `snippet.categoryId`: must be a valid category for the region; invalid -> `400 invalidCategoryId`. `22` is People & Blogs. Retrieve valid IDs with `videoCategories.list?part=snippet&regionCode=US`.

## Privacy and audience options

Source: https://developers.google.com/youtube/v3/docs/videos

- `status.privacyStatus`: `private` | `public` | `unlisted`.
- `status.publishAt`: schedule; only honoured when `privacyStatus` is `private`; a past date publishes immediately. suprstar schedules on its own side instead and always sends the final privacy value.
- `status.selfDeclaredMadeForKids`: uploader's declaration; `status.madeForKids` reflects YouTube's determination. Made-for-kids videos lose comments and personalised ads.
- `status.license`: `youtube` | `creativeCommon`. `status.embeddable`: boolean. `status.publicStatsViewable`: boolean.
- Invalid combinations return `403 forbiddenPrivacySetting` or `403 forbiddenLicenseSetting`.
- Unverified API project: every upload is forced to `private` regardless of `privacyStatus` (revision history 2020-07-28; see `overview.md`).

## Processing status after upload

Sources: https://developers.google.com/youtube/v3/guides/implementation/videos, https://developers.google.com/youtube/v3/docs/videos, https://developers.google.com/youtube/v3/docs/videos/list

- Poll `GET https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=<videoId>` (1 unit per call; these parts are owner-only, so use the same token).
- `status.uploadStatus`: `uploaded` (received, processing), `processed`, `failed`, `rejected`, `deleted`.
- `processingDetails.processingStatus`: `processing` | `succeeded` | `failed` | `terminated`; `processingFailureReason`: `other`, `streamingFailed`, `transcodeFailed`, `uploadFailed`; `processingProgress.{partsTotal,partsProcessed,timeLeftMs}`.
- Guidance: "your application could poll the API to periodically check the status of a newly uploaded video." suprstar does not; the in-app AI agent can suggest checking YouTube Studio or running this call manually.

## Known constraints and gotchas

- Daily cap: 100 `videos.insert` calls per Cloud project per day (all suprstar connections sharing one Client ID count together). Exceeding returns `403 quotaExceeded`.
- Channel cap: separate per-channel upload limits produce `400 uploadLimitExceeded` ("The channel's daily video upload limit has been reached." / "The user has exceeded the number of videos they may upload").
- `duplicate` rejection: uploading a byte-identical file the channel already has is rejected after processing (`status.rejectionReason: duplicate`), which the app never sees because it does not poll. Re-encode or change the file to re-upload.
- Access token expiry: the multipart upload sends the stored token as-is; an expired token gives `401` before any bytes are accepted.
- Memory: whole-file buffering means very large files can exhaust the Node process before any request is made.

## Metrics (YouTube Analytics API) reference for future `fetchMetrics`

Sources: https://developers.google.com/youtube/analytics/reference/reports/query, https://developers.google.com/youtube/analytics/channel_reports

- `GET https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&metrics=views,likes,comments,shares,subscribersGained,subscribersLost,estimatedMinutesWatched&dimensions=day&sort=day`
- Scope: `yt-analytics.readonly` (already requested by suprstar); monetary metrics need `yt-analytics-monetary.readonly` plus YouTube Partner Program.
- Response: `{"kind":"youtubeAnalytics#resultTable","columnHeaders":[{name,dataType,columnType}],"rows":[[...]]}`.
- Data freshness is not stated on the fetched pages; recent days are commonly incomplete (**unverified**).
- Requires the YouTube Analytics API to be enabled in the same Cloud project, otherwise `403 accessNotConfigured` (**unverified** reason string).
