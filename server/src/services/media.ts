import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { MediaAsset, PostFormat } from "@socmedia/shared";
import { config } from "../config";

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

  return {
    filename,
    absolutePath,
    url: `/uploads/${orgId}/${filename}`,
    mimeType,
    size: buffer.length,
    kind,
    width,
    height,
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
