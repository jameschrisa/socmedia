import { useEffect, useMemo, useRef, useState } from "react";
import useImage from "use-image";
import { FORMAT_SPECS, PLATFORM_SPECS, type Platform, type PostFormat } from "@socmedia/shared";
import { DEFAULT_FONT } from "@/lib/fontManifest";
import { clampPosition, exportRegion as computeExportRegion, fitStage, frameRect, normalizeRotation, type Point, type Rect, type Size } from "./imageMath";

export interface TextLayer {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  opacity: number;          // 0..1 text opacity
  bold: boolean;
  align: "left" | "center" | "right";
  background: boolean;
  backgroundColor: string;  // sticker background fill
  backgroundOpacity: number; // 0..1
}

/** A transparent PNG / logo / sticker overlaid on the post. */
export interface StickerLayer {
  id: string;
  src: string;   // data URL or same-origin media URL
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number; // 0..1
}

export type BadgeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export interface BadgeStyle {
  background: string | null; // null = organization brand colour
  text: string;
  corner: BadgeCorner;
}

export interface Adjustments {
  brightness: number; // -1..1
  contrast: number; // -100..100
  saturation: number; // -2..2
  blur: number; // 0..20 (px radius)
}

export const DEFAULT_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, saturation: 0, blur: 0 };

const STAGE_MAX = 520;

let layerId = 0;

export function useImageEditor(imageUrl: string, initialFormat: PostFormat, allowedFormats?: PostFormat[]) {
  const [image, status] = useImage(imageUrl, "anonymous");

  const formats = useMemo(() => (allowedFormats && allowedFormats.length ? allowedFormats : undefined), [allowedFormats]);
  const [format, setFormatState] = useState<PostFormat>(formats && !formats.includes(initialFormat) ? formats[0]! : initialFormat);

  const [zoom, setZoomState] = useState(1);
  const [rotationStep, setRotationStep] = useState(0);
  const [fineRotation, setFineRotationState] = useState(0);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [textLayers, setTextLayers] = useState<TextLayer[]>([]);
  const [stickers, setStickers] = useState<StickerLayer[]>([]);
  const [brandBadge, setBrandBadge] = useState(false);
  const [badgeStyle, setBadgeStyle] = useState<BadgeStyle>({ background: null, text: "#ffffff", corner: "top-left" });
  const updateBadgeStyle = (patch: Partial<BadgeStyle>) => setBadgeStyle((b) => ({ ...b, ...patch }));

  const stageRef = useRef<any>(null);
  const imageNodeRef = useRef<any>(null);

  const naturalSize: Size = image ? { width: (image as any).naturalWidth || image.width, height: (image as any).naturalHeight || image.height } : { width: 0, height: 0 };

  const stageSize = useMemo<Size>(() => {
    if (!naturalSize.width || !naturalSize.height) return { width: STAGE_MAX, height: STAGE_MAX };
    return fitStage(naturalSize.width, naturalSize.height, STAGE_MAX, STAGE_MAX);
  }, [naturalSize.width, naturalSize.height]);

  const frame = useMemo<Rect>(() => frameRect(stageSize.width, stageSize.height, FORMAT_SPECS[format].ratio), [stageSize.width, stageSize.height, format]);

  const baseScale = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height) return 1;
    return Math.max(frame.width / naturalSize.width, frame.height / naturalSize.height);
  }, [naturalSize.width, naturalSize.height, frame.width, frame.height]);

  const displaySize: Size = useMemo(
    () => ({ width: naturalSize.width * baseScale * zoom, height: naturalSize.height * baseScale * zoom }),
    [naturalSize.width, naturalSize.height, baseScale, zoom],
  );

  // Re-centre the image whenever it loads or the crop format changes.
  useEffect(() => {
    setPosition({ x: frame.x + (frame.width - displaySize.width) / 2, y: frame.y + (frame.height - displaySize.height) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, naturalSize.width, naturalSize.height]);

  // Keep the frame covered whenever zoom/geometry changes without recentring.
  useEffect(() => {
    setPosition((p) => clampPosition(p, displaySize, frame));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, frame.x, frame.y, frame.width, frame.height, displaySize.width, displaySize.height]);

  const setZoom = (z: number) => setZoomState(Math.min(4, Math.max(1, z)));
  const setFineRotation = (v: number) => setFineRotationState(Math.min(45, Math.max(-45, v)));
  const rotateBy90 = (dir: 1 | -1) => setRotationStep((r) => normalizeRotation(r + dir * 90));
  const rotation = normalizeRotation(rotationStep + fineRotation);

  const setFormat = (f: PostFormat) => {
    if (formats && !formats.includes(f)) return;
    setFormatState(f);
  };

  const setPlatformShortcut = (platform: Platform) => {
    const spec = PLATFORM_SPECS[platform];
    if (!formats) { setFormatState(spec.defaultFormat); return; }
    const next = spec.formats.find((f) => formats.includes(f)) ?? formats[0]!;
    setFormatState(next);
  };

  const onDragMove = (pos: Point) => setPosition(clampPosition(pos, displaySize, frame));

  const resetAdjustments = () => setAdjustments(DEFAULT_ADJUSTMENTS);
  const resetTransform = () => {
    setZoomState(1);
    setRotationStep(0);
    setFineRotationState(0);
  };

  const addTextLayer = () =>
    setTextLayers((list) => [
      ...list,
      {
        id: `text-${Date.now()}-${layerId++}`,
        text: "New text",
        x: frame.x + frame.width / 2 - 60,
        y: frame.y + frame.height / 2 - 14,
        fontSize: 28,
        fontFamily: DEFAULT_FONT,
        color: "#ffffff",
        opacity: 1,
        bold: true,
        align: "center",
        background: false,
        backgroundColor: "#000000",
        backgroundOpacity: 0.45,
      },
    ]);
  const updateTextLayer = (id: string, patch: Partial<TextLayer>) => setTextLayers((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeTextLayer = (id: string) => setTextLayers((list) => list.filter((t) => t.id !== id));

  /** Add an overlay image; sized to roughly a third of the crop frame, centred, keeping the source aspect when known. */
  const addSticker = (src: string, name: string, natural?: Size): string => {
    const id = `sticker-${Date.now()}-${layerId++}`;
    const targetW = Math.max(40, Math.round(frame.width * 0.35));
    const ratio = natural && natural.width > 0 && natural.height > 0 ? natural.height / natural.width : 1;
    const width = targetW;
    const height = Math.round(targetW * ratio);
    setStickers((list) => [
      ...list,
      { id, src, name, x: frame.x + frame.width / 2 - width / 2, y: frame.y + frame.height / 2 - height / 2, width, height, rotation: 0, opacity: 1 },
    ]);
    return id;
  };
  const updateSticker = (id: string, patch: Partial<StickerLayer>) => setStickers((list) => list.map((st) => (st.id === id ? { ...st, ...patch } : st)));
  const removeSticker = (id: string) => setStickers((list) => list.filter((st) => st.id !== id));
  const bringStickerForward = (id: string) =>
    setStickers((list) => {
      const idx = list.findIndex((st) => st.id === id);
      if (idx < 0 || idx === list.length - 1) return list;
      const next = [...list];
      const [item] = next.splice(idx, 1);
      next.push(item!);
      return next;
    });
  /** Resize keeping the aspect ratio, from a percentage of the frame width. */
  const setStickerScale = (id: string, percentOfFrame: number) =>
    setStickers((list) =>
      list.map((st) => {
        if (st.id !== id) return st;
        const ratio = st.height / st.width;
        const width = Math.max(16, (frame.width * percentOfFrame) / 100);
        const cx = st.x + st.width / 2;
        const cy = st.y + st.height / 2;
        return { ...st, width, height: width * ratio, x: cx - width / 2, y: cy - width * ratio / 2 };
      }),
    );

  const region = useMemo(() => computeExportRegion(frame, format), [frame, format]);

  return {
    image,
    status,
    format,
    availableFormats: formats,
    setFormat,
    setPlatformShortcut,
    zoom,
    setZoom,
    rotation,
    rotationStep,
    fineRotation,
    setFineRotation,
    rotateBy90,
    position,
    onDragMove,
    stageSize,
    frame,
    displaySize,
    adjustments,
    setAdjustments,
    resetAdjustments,
    resetTransform,
    textLayers,
    addTextLayer,
    updateTextLayer,
    removeTextLayer,
    stickers,
    addSticker,
    updateSticker,
    removeSticker,
    bringStickerForward,
    setStickerScale,
    brandBadge,
    setBrandBadge,
    badgeStyle,
    updateBadgeStyle,
    stageRef,
    imageNodeRef,
    exportRegion: region,
  };
}
