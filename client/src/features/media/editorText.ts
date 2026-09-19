import Konva from "konva";

/** Measure rendered text width with Konva; falls back to a heuristic when no canvas is available (tests). */
export function measureTextWidth(text: string, fontSize: number, fontFamily: string, fontStyle: string): number {
  try {
    const KText = (Konva as any)?.Text;
    if (typeof KText === "function") {
      const node = new KText({ text, fontSize, fontFamily, fontStyle });
      const w = node.getTextWidth?.() ?? node.width?.();
      node.destroy?.();
      if (Number.isFinite(w) && w > 0) return w;
    }
  } catch {
    /* fall through */
  }
  return text.length * fontSize * 0.55;
}

/** #rrggbb + alpha → rgba() string for Konva fills. */
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Read a File as a data URL (for sticker uploads kept in memory). */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/** Natural size of an image URL; resolves undefined when it cannot be determined (e.g. jsdom). */
export function probeImageSize(src: string): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve(undefined);
    const img = new Image();
    const timer = setTimeout(() => resolve(undefined), 3000);
    img.onload = () => { clearTimeout(timer); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { clearTimeout(timer); resolve(undefined); };
    img.src = src;
  });
}
