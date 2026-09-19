import { useEffect, useRef, useState } from "react";
import Konva from "konva";
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import useImage from "use-image";
import { ArrowUpToLine, ImagePlus, Library, RotateCcw, RotateCw, Sticker as StickerIcon, Trash2, Type as TypeIcon } from "lucide-react";
import { FORMAT_SPECS, PLATFORMS, POST_FORMATS, PLATFORM_SPECS, type MediaAsset, type Platform, type PostFormat } from "@socmedia/shared";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { PlatformIcon } from "@/components/ui/PlatformIcon";
import { useOrgs } from "@/hooks/useOrg";
import { cn } from "@/lib/utils";
import { useImageEditor } from "./useImageEditor";
import { FontPicker } from "./FontPicker";
import { MediaPicker } from "./MediaPicker";
import { useMedia } from "@/hooks/useMedia";
import { toast } from "sonner";
import { measureTextWidth, probeImageSize, readFileAsDataUrl, rgba } from "./editorText";
import type { StickerLayer } from "./useImageEditor";
import { fontStack } from "@/lib/fontManifest";

export interface ImageEditorExportResult {
  dataUrl: string;
  format: PostFormat;
  width: number;
  height: number;
}

export interface ImageEditorProps {
  asset: MediaAsset;
  initialFormat: PostFormat;
  allowedFormats?: PostFormat[];
  onExport: (result: ImageEditorExportResult) => void;
  onClose: () => void;
}

const PRESET_ORDER: PostFormat[] = [...POST_FORMATS];

export function ImageEditor({ asset, initialFormat, allowedFormats, onExport, onClose }: ImageEditorProps) {
  const { currentOrg } = useOrgs();
  const editor = useImageEditor(asset.url, initialFormat, allowedFormats);

  // Load any self-hosted font faces used by text layers before Konva draws them, then redraw.
  const usedFonts = editor.textLayers.map((t) => t.fontFamily).join("|");
  useEffect(() => {
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts?.load || !usedFonts) return;
    let cancelled = false;
    Promise.all(usedFonts.split("|").flatMap((family) => [fonts.load(`400 16px "${family}"`), fonts.load(`700 16px "${family}"`)]))
      .catch(() => undefined)
      .then(() => { if (!cancelled) editor.stageRef.current?.batchDraw(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedFonts]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: library } = useMedia();

  const addStickerFromFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) { toast.error(`${file.name} is not an image`); continue; }
      const src = await readFileAsDataUrl(file);
      const natural = await probeImageSize(src);
      const id = editor.addSticker(src, file.name, natural);
      setSelectedStickerId(id);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addStickersFromLibrary = async (ids: string[]) => {
    for (const id of ids) {
      const asset = library?.find((m) => m.id === id);
      if (!asset || asset.kind !== "image") continue;
      const natural = asset.width && asset.height ? { width: asset.width, height: asset.height } : await probeImageSize(asset.url);
      const stickerId = editor.addSticker(asset.url, asset.filename, natural);
      setSelectedStickerId(stickerId);
    }
  };

  const presets = allowedFormats && allowedFormats.length ? PRESET_ORDER.filter((f) => allowedFormats.includes(f)) : PRESET_ORDER;

  const handleExport = () => {
    const stage = editor.stageRef.current;
    if (!stage) return;
    const region = editor.exportRegion;
    const dataUrl = stage.toDataURL({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      pixelRatio: region.pixelRatio,
      mimeType: region.mimeType,
      quality: region.quality,
    });
    onExport({ dataUrl, format: editor.format, width: FORMAT_SPECS[editor.format].width, height: FORMAT_SPECS[editor.format].height });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Edit ${asset.filename}`}
      description="Crop, adjust and add overlays before exporting a platform-ready image."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleExport} data-testid="editor-export">Save export</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-5">
        {/* Left: canvas */}
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => editor.setFormat(f)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  editor.format === f ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-600 hover:bg-ink-50",
                )}
              >
                {FORMAT_SPECS[f].label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => editor.setPlatformShortcut(p)}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50"
              >
                <PlatformIcon platform={p} size={16} mono />
                {PLATFORM_SPECS[p].name}
              </button>
            ))}
          </div>

          <div
            className="relative mx-auto rounded-xl bg-canvas overflow-hidden ring-1 ring-ink-200"
            style={{ width: editor.stageSize.width, height: editor.stageSize.height }}
          >
            <Stage width={editor.stageSize.width} height={editor.stageSize.height} ref={editor.stageRef}>
              <Layer>
                {editor.image && (
                  <KonvaImage
                    ref={editor.imageNodeRef}
                    image={editor.image}
                    x={editor.position.x}
                    y={editor.position.y}
                    width={editor.displaySize.width}
                    height={editor.displaySize.height}
                    rotation={editor.rotation}
                    draggable
                    onDragMove={(e: any) => editor.onDragMove({ x: e.target.x(), y: e.target.y() })}
                    filters={[Konva.Filters.Brighten, Konva.Filters.Contrast, Konva.Filters.HSL, Konva.Filters.Blur]}
                    brightness={editor.adjustments.brightness}
                    contrast={editor.adjustments.contrast}
                    saturation={editor.adjustments.saturation}
                    blurRadius={editor.adjustments.blur}
                  />
                )}
                {/* dim overlay outside the crop frame */}
                <Rect x={0} y={0} width={editor.stageSize.width} height={editor.frame.y} fill="rgba(0,0,0,0.55)" listening={false} />
                <Rect x={0} y={editor.frame.y + editor.frame.height} width={editor.stageSize.width} height={editor.stageSize.height - editor.frame.y - editor.frame.height} fill="rgba(0,0,0,0.55)" listening={false} />
                <Rect x={0} y={editor.frame.y} width={editor.frame.x} height={editor.frame.height} fill="rgba(0,0,0,0.55)" listening={false} />
                <Rect x={editor.frame.x + editor.frame.width} y={editor.frame.y} width={editor.stageSize.width - editor.frame.x - editor.frame.width} height={editor.frame.height} fill="rgba(0,0,0,0.55)" listening={false} />
                <Rect x={editor.frame.x} y={editor.frame.y} width={editor.frame.width} height={editor.frame.height} stroke="#fff" strokeWidth={2} listening={false} />
                {/* rule of thirds */}
                {[1, 2].map((i) => (
                  <Line key={`v${i}`} points={[editor.frame.x + (editor.frame.width * i) / 3, editor.frame.y, editor.frame.x + (editor.frame.width * i) / 3, editor.frame.y + editor.frame.height]} stroke="rgba(255,255,255,0.4)" listening={false} />
                ))}
                {[1, 2].map((i) => (
                  <Line key={`h${i}`} points={[editor.frame.x, editor.frame.y + (editor.frame.height * i) / 3, editor.frame.x + editor.frame.width, editor.frame.y + (editor.frame.height * i) / 3]} stroke="rgba(255,255,255,0.4)" listening={false} />
                ))}
                {editor.textLayers.map((t) => (
                  <Group key={t.id} x={t.x} y={t.y} draggable onDragMove={(e: any) => editor.updateTextLayer(t.id, { x: e.target.x(), y: e.target.y() })} onClick={() => { setSelectedTextId(t.id); setSelectedStickerId(null); }}>
                    {t.background && (
                      <Rect
                        width={measureTextWidth(t.text, t.fontSize, fontStack(t.fontFamily), t.bold ? "bold" : "normal") + 16}
                        height={t.fontSize + 16}
                        fill={rgba(t.backgroundColor, t.backgroundOpacity)}
                        cornerRadius={8}
                      />
                    )}
                    <Text text={t.text} fontSize={t.fontSize} fontFamily={fontStack(t.fontFamily)} fill={t.color} opacity={t.opacity} fontStyle={t.bold ? "bold" : "normal"} align={t.align} padding={8} />
                  </Group>
                ))}
                {editor.stickers.map((st) => (
                  <StickerNode
                    key={st.id}
                    sticker={st}
                    selected={selectedStickerId === st.id}
                    onSelect={() => { setSelectedStickerId(st.id); setSelectedTextId(null); }}
                    onChange={(patch) => editor.updateSticker(st.id, patch)}
                  />
                ))}
                {editor.brandBadge && currentOrg && (() => {
                  const pillW = Math.max(90, measureTextWidth(currentOrg.name, 13, fontStack("Inter"), "bold") + 28);
                  return (
                    <Group x={editor.frame.x + 12} y={editor.frame.y + 12}>
                      <Rect width={pillW} height={28} cornerRadius={14} fill={currentOrg.brandColor} />
                      <Text text={currentOrg.name} x={0} y={0} width={pillW} height={28} align="center" verticalAlign="middle" fontSize={13} fontFamily={fontStack("Inter")} fill="#fff" fontStyle="bold" />
                    </Group>
                  );
                })()}
              </Layer>
            </Stage>
            {/* Plain DOM overlay so the current crop aspect is testable/inspectable without reaching into Konva internals. */}
            <div
              data-testid="crop-frame"
              data-format={editor.format}
              className="pointer-events-none absolute border-2 border-white/80"
              style={{ left: editor.frame.x, top: editor.frame.y, width: editor.frame.width, height: editor.frame.height }}
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex flex-1 items-center gap-2 text-xs text-ink-600">
              Zoom
              <input type="range" min={1} max={4} step={0.05} value={editor.zoom} onChange={(e) => editor.setZoom(Number(e.target.value))} className="flex-1" />
            </label>
            <Button variant="outline" size="xs" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => editor.rotateBy90(-1)} aria-label="Rotate left 90 degrees" />
            <Button variant="outline" size="xs" icon={<RotateCw className="h-3.5 w-3.5" />} onClick={() => editor.rotateBy90(1)} aria-label="Rotate right 90 degrees" />
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-600">
            Fine rotate
            <input type="range" min={-45} max={45} step={1} value={editor.fineRotation} onChange={(e) => editor.setFineRotation(Number(e.target.value))} className="flex-1" />
            <span className="w-10 text-right tabular-nums">{editor.rotation}°</span>
          </label>
        </div>

        {/* Right: adjustments, text, badge */}
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-900">Adjustments</h3>
              <button type="button" className="link text-xs" onClick={editor.resetAdjustments}>Reset</button>
            </div>
            <div className="space-y-2.5">
              <SliderField label="Brightness" min={-1} max={1} step={0.05} value={editor.adjustments.brightness} onChange={(v) => editor.setAdjustments((a) => ({ ...a, brightness: v }))} />
              <SliderField label="Contrast" min={-100} max={100} step={5} value={editor.adjustments.contrast} onChange={(v) => editor.setAdjustments((a) => ({ ...a, contrast: v }))} />
              <SliderField label="Saturation" min={-2} max={2} step={0.1} value={editor.adjustments.saturation} onChange={(v) => editor.setAdjustments((a) => ({ ...a, saturation: v }))} />
              <SliderField label="Blur" min={0} max={20} step={1} value={editor.adjustments.blur} onChange={(v) => editor.setAdjustments((a) => ({ ...a, blur: v }))} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-900">Text overlay</h3>
              <Button variant="outline" size="xs" icon={<TypeIcon className="h-3.5 w-3.5" />} onClick={editor.addTextLayer}>Add text</Button>
            </div>
            <div className="space-y-3">
              {editor.textLayers.length === 0 && <p className="text-xs text-ink-500">No text layers yet.</p>}
              {editor.textLayers.map((t) => (
                <div key={t.id} className={cn("rounded-lg border p-2.5 space-y-2", selectedTextId === t.id ? "border-brand-300 bg-brand-50" : "border-ink-200")}>
                  <div className="flex items-center gap-2">
                    <input className="input flex-1" value={t.text} onChange={(e) => editor.updateTextLayer(t.id, { text: e.target.value })} onFocus={() => setSelectedTextId(t.id)} />
                    <button type="button" aria-label="Remove text layer" className="text-ink-400 hover:text-red-600" onClick={() => editor.removeTextLayer(t.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <FontPicker value={t.fontFamily} onChange={(family) => editor.updateTextLayer(t.id, { fontFamily: family })} />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">Size <input type="number" min={10} max={96} className="input w-16" value={t.fontSize} onChange={(e) => editor.updateTextLayer(t.id, { fontSize: Number(e.target.value) })} /></label>
                    <label className="flex items-center gap-1">Colour <input type="color" value={t.color} onChange={(e) => editor.updateTextLayer(t.id, { color: e.target.value })} /></label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={t.bold} onChange={(e) => editor.updateTextLayer(t.id, { bold: e.target.checked })} /> Bold
                    </label>
                    <select className="input w-24" value={t.align} onChange={(e) => editor.updateTextLayer(t.id, { align: e.target.value as "left" | "center" | "right" })}>
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={t.background} onChange={(e) => editor.updateTextLayer(t.id, { background: e.target.checked })} /> Sticker bg
                    </label>
                  </div>
                  <SliderField label="Text opacity" min={0} max={100} step={5} value={Math.round(t.opacity * 100)} onChange={(v) => editor.updateTextLayer(t.id, { opacity: v / 100 })} />
                  {t.background && (
                    <div className="space-y-1.5 border-t border-ink-100 pt-2" data-testid="sticker-bg-controls">
                      <label className="flex items-center gap-2 text-xs text-ink-600">
                        <span className="w-20 shrink-0">Bg colour</span>
                        <input type="color" aria-label="Sticker background colour" value={t.backgroundColor} onChange={(e) => editor.updateTextLayer(t.id, { backgroundColor: e.target.value })} />
                        <span className="font-mono text-[11px] text-ink-500">{t.backgroundColor}</span>
                      </label>
                      <SliderField label="Bg opacity" min={0} max={100} step={5} value={Math.round(t.backgroundOpacity * 100)} onChange={(v) => editor.updateTextLayer(t.id, { backgroundOpacity: v / 100 })} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2" data-testid="stickers-panel">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-900 inline-flex items-center gap-1.5"><StickerIcon className="h-4 w-4 text-brand-500" /> Stickers & overlays</h3>
              <div className="flex gap-1.5">
                <input ref={fileInputRef} type="file" accept="image/png,image/webp,image/svg+xml,image/gif,image/jpeg" multiple className="hidden" data-testid="sticker-file-input" onChange={(e) => void addStickerFromFiles(e.target.files)} />
                <Button variant="outline" size="xs" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => fileInputRef.current?.click()} title="Upload a transparent PNG, SVG or WebP">Upload</Button>
                <Button variant="outline" size="xs" icon={<Library className="h-3.5 w-3.5" />} onClick={() => setPickerOpen(true)}>Library</Button>
              </div>
            </div>
            <p className="text-xs text-ink-500">Transparent PNGs, logos or badges. Drag on the canvas to place; drag the handles to resize or rotate.</p>
            {editor.stickers.length === 0 && <p className="text-xs text-ink-400">No overlays yet.</p>}
            {editor.stickers.map((st) => (
              <div key={st.id} className={cn("rounded-lg border p-2.5 space-y-2", selectedStickerId === st.id ? "border-brand-300 bg-brand-50" : "border-ink-200")} data-testid="sticker-row" onClick={() => setSelectedStickerId(st.id)}>
                <div className="flex items-center gap-2">
                  <img src={st.src} alt="" className="h-8 w-8 shrink-0 rounded border border-ink-200 object-contain bg-[repeating-conic-gradient(#e5e7eb_0_25%,#fff_0_50%)] bg-[length:8px_8px]" />
                  <span className="flex-1 truncate text-xs font-medium text-ink-800" title={st.name}>{st.name}</span>
                  <button type="button" aria-label="Bring sticker forward" className="text-ink-400 hover:text-ink-700" onClick={(e) => { e.stopPropagation(); editor.bringStickerForward(st.id); }}><ArrowUpToLine className="h-4 w-4" /></button>
                  <button type="button" aria-label="Remove sticker" className="text-ink-400 hover:text-red-600" onClick={(e) => { e.stopPropagation(); editor.removeSticker(st.id); if (selectedStickerId === st.id) setSelectedStickerId(null); }}><Trash2 className="h-4 w-4" /></button>
                </div>
                <SliderField label="Opacity" min={0} max={100} step={5} value={Math.round(st.opacity * 100)} onChange={(v) => editor.updateSticker(st.id, { opacity: v / 100 })} />
                <SliderField label="Size" min={5} max={100} step={1} value={Math.round((st.width / Math.max(1, editor.frame.width)) * 100)} onChange={(v) => editor.setStickerScale(st.id, v)} />
                <SliderField label="Rotate" min={-180} max={180} step={1} value={Math.round(st.rotation)} onChange={(v) => editor.updateSticker(st.id, { rotation: v })} />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-ink-200 p-3">
            <div>
              <p className="text-sm font-medium text-ink-900">Brand badge</p>
              <p className="text-xs text-ink-500">{currentOrg ? currentOrg.name : "Org"} pill in the corner</p>
            </div>
            <Toggle checked={editor.brandBadge} onChange={editor.setBrandBadge} label="Toggle brand badge" />
          </div>
        </div>
      </div>
      <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={(ids) => void addStickersFromLibrary(ids)} />
    </Modal>
  );
}

/** Overlay image with a transformer for resize/rotate when selected. */
function StickerNode({ sticker, selected, onSelect, onChange }: { sticker: StickerLayer; selected: boolean; onSelect: () => void; onChange: (patch: Partial<StickerLayer>) => void }) {
  const [img] = useImage(sticker.src, "anonymous");
  const nodeRef = useRef<any>(null);
  const trRef = useRef<any>(null);

  useEffect(() => {
    if (selected && trRef.current && nodeRef.current) {
      trRef.current.nodes([nodeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selected, img]);

  if (!img) return null;
  return (
    <>
      <KonvaImage
        ref={nodeRef}
        image={img}
        x={sticker.x}
        y={sticker.y}
        width={sticker.width}
        height={sticker.height}
        rotation={sticker.rotation}
        opacity={sticker.opacity}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={onSelect}
        onDragEnd={(e: any) => onChange({ x: e.target.x(), y: e.target.y() })}
        onTransformEnd={(e: any) => {
          const node = e.target;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({ x: node.x(), y: node.y(), width: Math.max(8, node.width() * scaleX), height: Math.max(8, node.height() * scaleY), rotation: node.rotation() });
        }}
      />
      {selected && (
        <Transformer
          ref={trRef}
          keepRatio
          rotateEnabled
          enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
          anchorSize={8}
          anchorCornerRadius={4}
          borderStroke="#7C5CFC"
          anchorStroke="#7C5CFC"
          boundBoxFunc={(oldBox: any, newBox: any) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
        />
      )}
    </>
  );
}

function SliderField({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-600">
      <span className="w-20 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1" />
      <span className="w-10 text-right tabular-nums">{value}</span>
    </label>
  );
}
