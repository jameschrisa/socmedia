/**
 * Pure geometry helpers for the Konva-based image editor.
 * Kept free of any Konva/DOM imports so they can be unit tested directly
 * (Konva cannot render under jsdom - see ImageEditor.test.tsx for the mocking strategy).
 */
import { FORMAT_SPECS, type PostFormat } from "@socmedia/shared";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point, Size {}

/**
 * "Contain" fit: the largest size that fits within maxW x maxH while
 * preserving the source's aspect ratio. Used to size the Stage container.
 */
export function fitStage(imageW: number, imageH: number, maxW: number, maxH: number): Size {
  if (!(imageW > 0) || !(imageH > 0) || !(maxW > 0) || !(maxH > 0)) {
    return { width: maxW, height: maxH };
  }
  const scale = Math.min(maxW / imageW, maxH / imageH);
  return { width: Math.round(imageW * scale), height: Math.round(imageH * scale) };
}

/**
 * The largest centred rect with the given aspect ratio (width / height) that
 * fits inside a stageW x stageH box - the crop frame overlay.
 */
export function frameRect(stageW: number, stageH: number, ratio: number): Rect {
  let width = stageW;
  let height = ratio > 0 ? width / ratio : stageH;
  if (height > stageH) {
    height = stageH;
    width = height * ratio;
  }
  return {
    x: Math.round((stageW - width) / 2),
    y: Math.round((stageH - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * Clamp an image's top-left position so its (already-scaled) bounds keep
 * covering the crop frame. When the image is smaller than the frame on an
 * axis it is centred on that axis instead (can't fully cover it).
 */
export function clampPosition(pos: Point, imageSize: Size, frame: Rect): Point {
  let x = pos.x;
  let y = pos.y;

  if (imageSize.width <= frame.width) {
    x = frame.x + (frame.width - imageSize.width) / 2;
  } else {
    const minX = frame.x + frame.width - imageSize.width;
    const maxX = frame.x;
    x = Math.min(maxX, Math.max(minX, x));
  }

  if (imageSize.height <= frame.height) {
    y = frame.y + (frame.height - imageSize.height) / 2;
  } else {
    const minY = frame.y + frame.height - imageSize.height;
    const maxY = frame.y;
    y = Math.min(maxY, Math.max(minY, y));
  }

  return { x, y };
}

export interface ExportRegion extends Rect {
  pixelRatio: number;
  mimeType: "image/jpeg";
  quality: number;
}

/**
 * Parameters for `stage.toDataURL(...)` that render the crop frame at the
 * format's recommended export resolution (FORMAT_SPECS[format].width/height).
 */
export function exportRegion(frame: Rect, format: PostFormat): ExportRegion {
  const spec = FORMAT_SPECS[format];
  const pixelRatio = frame.width > 0 ? spec.width / frame.width : 1;
  return {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    pixelRatio,
    mimeType: "image/jpeg",
    quality: 0.92,
  };
}

/** Normalise a rotation value (degrees) into the [0, 360) range. */
export function normalizeRotation(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}
