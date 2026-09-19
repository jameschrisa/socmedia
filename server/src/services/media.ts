import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { MediaAsset, PostFormat } from "@socmedia/shared";
import { VIDEO_MAX_SECONDS } from "@socmedia/shared";
import { config } from "../config";
import { posterFrame, probeVideo } from "./video";

/** Thrown when an uploaded/derived video exceeds VIDEO_MAX_SECONDS; the file has already been removed. */
export class VideoTooLongError extends Error {
  durationSeconds: number;
  constructor(durationSeconds: number) {
    super(`Video is ${durationSeconds}s, longer than the ${VIDEO_MAX_SECONDS}s limit`);
    this.name = "VideoTooLongError";
    this.durationSeconds = durationSeconds;
  }
}

/** Formats a duration in seconds as "M:SS" for user-facing error messages. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function uploadsDirFor(orgId: string): string {
  return path.join(config.dataDir, "uploads", orgId);
}

export function ensureUploadsDir(orgId: string): string {
  const dir = uploadsDirFor(orgId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Converts a stored MediaAsset URL (e.g. "/uploads/org/file.png") into an absolute filesystem path. */
export function resolveMediaPath(url: string): string {
  const relative = url.replace(/^\/uploads\//, "");
  return path.join(config.dataDir, "uploads", relative);
}

/** Absolute, publicly reachable URL for a stored asset (used by live platform adapters). */
export function toAbsoluteUrl(url: string, fallbackHost?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = config.publicBaseUrl || fallbackHost || `http://localhost:${config.port}`;
  return `${base.replace(/\/$/, "")}${url}`;
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  return map[mime] || mime.split("/")[1] || "bin";
}

export interface SavedFile {
  filename: string;
  absolutePath: string;
  url: string;
  mimeType: string;
  size: number;
  kind: "image" | "video";
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  thumbnailUrl?: string | null;
}

/** Persists an uploaded buffer to disk, detecting image dimensions and generating a thumbnail. */
export async function saveUploadBuffer(orgId: string, buffer: Buffer, mimeType: string, originalName?: string): Promise<SavedFile> {
  const dir = ensureUploadsDir(orgId);
  const kind: "image" | "video" = mimeType.startsWith("video/") ? "video" : "image";
  const ext = originalName?.includes(".") ? originalName.split(".").pop()! : extFromMime(mimeType);
  const filename = `${nanoid(12)}.${ext}`;
  const absolutePath = path.join(dir, filename);
  fs.writeFileSync(absolutePath, buffer);

  let width: number | null = null;
  let height: number | null = null;
  let durationSeconds: number | null = null;
  let thumbnailUrl: string | null = null;

  if (kind === "image") {
    try {
      const meta = await sharp(buffer).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      const thumbName = `${path.parse(filename).name}_thumb.webp`;
      const thumbPath = path.join(dir, thumbName);
      await sharp(buffer).resize({ width: 480 }).webp({ quality: 80 }).toFile(thumbPath);
      thumbnailUrl = `/uploads/${orgId}/${thumbName}`;
    } catch {
      // not a decodable image; leave dimensions/thumbnail unset
    }
  }

  if (kind === "video") {
    let probe: Awaited<ReturnType<typeof probeVideo>> | null = null;
    try {
      probe = await probeVideo(absolutePath);
    } catch {
      probe = null;
    }
    if (probe) {
      if (probe.durationSeconds > VIDEO_MAX_SECONDS) {
        try {
          fs.unlinkSync(absolutePath);
        } catch {
          // already gone
        }
        throw new VideoTooLongError(probe.durationSeconds);
      }
      durationSeconds = probe.durationSeconds;
      width = probe.width;
      height = probe.height;
      try {
        const thumbName = `${path.parse(filename).name}_poster.jpg`;
        const thumbPath = path.join(dir, thumbName);
        await posterFrame(absolutePath, thumbPath);
        thumbnailUrl = `/uploads/${orgId}/${thumbName}`;
      } catch {
        // poster generation failed; leave thumbnail unset
      }
    }
  }

  // The file on disk gets a random name; the asset keeps the original name for display.
  const displayName = originalName ? path.basename(originalName).replace(/[\r\n]/g, "").trim() : "";
  return {
    filename: displayName || filename,
    absolutePath,
    url: `/uploads/${orgId}/${filename}`,
    mimeType,
    size: buffer.length,
    kind,
    width,
    height,
    durationSeconds,
    thumbnailUrl,
  };
}

/** Decodes a data: URL and saves it like an upload (used by the image editor export flow). */
export async function saveDataUrl(orgId: string, dataUrl: string, filename?: string): Promise<SavedFile> {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid data URL");
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  return saveUploadBuffer(orgId, buffer, mimeType, filename);
}

/** Copy an existing asset's file into new stored files (new names, fresh thumbnail) for duplication. */
export async function copyMediaFiles(asset: Pick<MediaAsset, "url" | "mimeType" | "filename">, orgId: string): Promise<SavedFile> {
  const buffer = fs.readFileSync(resolveMediaPath(asset.url));
  return saveUploadBuffer(orgId, buffer, asset.mimeType, asset.filename);
}

export function deleteMediaFiles(asset: Pick<MediaAsset, "url" | "thumbnailUrl">) {
  for (const url of [asset.url, asset.thumbnailUrl]) {
    if (!url) continue;
    try {
      fs.unlinkSync(resolveMediaPath(url));
    } catch {
      // already gone
    }
  }
}

export function formatFor(format?: string | null): PostFormat | null {
  return (format as PostFormat) ?? null;
}
