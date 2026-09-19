import type { Adjustments } from "./useImageEditor";

export type TintBlend = "multiply" | "screen" | "soft-light" | "overlay";

export interface Tint {
  color: string;   // #rrggbb
  alpha: number;   // 0..1
  blend: TintBlend;
}

/** Everything a look can set. Unset keys fall back to the neutral defaults. */
export type Look = Partial<Adjustments>;

export interface FilterPreset {
  key: string;
  name: string;
  description: string;
  look: Look;
}

export const NEUTRAL_LOOK: Adjustments = {
  brightness: 0, contrast: 0, saturation: 0, blur: 0,
  hue: 0, sepia: 0, grayscale: 0, noise: 0, vignette: 0, fade: 0, tint: null,
};

export const FILTER_PRESETS: FilterPreset[] = [
  { key: "none", name: "Original", description: "No look applied.", look: {} },
  {
    key: "polaroid", name: "Polaroid", description: "Soft contrast, lifted blacks, warm cast, light grain.",
    look: { contrast: -12, saturation: -0.25, brightness: 0.06, fade: 0.45, vignette: 0.25, noise: 0.12, tint: { color: "#f2c58c", alpha: 0.18, blend: "soft-light" } },
  },
  {
    key: "y2k", name: "Y2K Lofi", description: "Punchy colour, magenta haze, visible grain.",
    look: { contrast: 18, saturation: 0.45, brightness: 0.04, noise: 0.28, fade: 0.15, tint: { color: "#ff4fd8", alpha: 0.16, blend: "screen" } },
  },
  {
    key: "noir", name: "Monochrome Noir", description: "Deep black and white with a heavy vignette.",
    look: { grayscale: 1, contrast: 32, brightness: -0.04, vignette: 0.7, noise: 0.08 },
  },
  {
    key: "warm", name: "Warm Glow", description: "Golden light, gentle lift, richer colour.",
    look: { brightness: 0.1, saturation: 0.15, contrast: 4, tint: { color: "#ffb347", alpha: 0.3, blend: "soft-light" }, vignette: 0.12 },
  },
  {
    key: "matte", name: "Matte", description: "Flat, faded blacks with muted colour.",
    look: { contrast: -18, saturation: -0.2, fade: 0.55, brightness: 0.02 },
  },
  {
    key: "vintage", name: "Vintage", description: "Sepia tone, dust-like grain, darkened corners.",
    look: { sepia: 1, contrast: 6, noise: 0.18, vignette: 0.45, brightness: 0.03 },
  },
  {
    key: "chrome", name: "Cool Chrome", description: "Steely blue shadows, crisp contrast.",
    look: { contrast: 14, saturation: -0.15, tint: { color: "#4f7fd9", alpha: 0.22, blend: "soft-light" }, vignette: 0.18 },
  },
  {
    key: "vivid", name: "Vivid Pop", description: "Saturated, high-contrast colour.",
    look: { saturation: 0.6, contrast: 22, brightness: 0.02 },
  },
  {
    key: "golden", name: "Golden Hour", description: "Late-sun amber wash with soft edges.",
    look: { brightness: 0.08, saturation: 0.1, tint: { color: "#f59e0b", alpha: 0.38, blend: "overlay" }, vignette: 0.3, fade: 0.1 },
  },
  {
    key: "dreamy", name: "Dreamy", description: "Soft focus and a milky lift.",
    look: { blur: 2, brightness: 0.1, saturation: -0.05, fade: 0.35, tint: { color: "#ffffff", alpha: 0.1, blend: "screen" } },
  },
  {
    key: "cinema", name: "Cinema Teal", description: "Teal shadows, warm skin, widescreen mood.",
    look: { contrast: 12, saturation: 0.05, tint: { color: "#0f8b8d", alpha: 0.24, blend: "multiply" }, vignette: 0.35, fade: 0.08 },
  },
];

export function presetByKey(key: string): FilterPreset | undefined {
  return FILTER_PRESETS.find((p) => p.key === key);
}

/** Full adjustment set for a preset (neutral defaults with the look applied). */
export function adjustmentsForPreset(key: string): Adjustments {
  const preset = presetByKey(key);
  return { ...NEUTRAL_LOOK, ...(preset?.look ?? {}) };
}

/** Which preset (if any) exactly matches the current adjustments. */
export function matchingPreset(adj: Adjustments): string | null {
  for (const p of FILTER_PRESETS) {
    const full = adjustmentsForPreset(p.key);
    if (JSON.stringify(full) === JSON.stringify(adj)) return p.key;
  }
  return null;
}

/**
 * CSS approximation of a look for thumbnail chips (Konva does the real render).
 * Tint, fade, vignette and grain are approximated with a mix of sepia/brightness; close enough for a 48px preview.
 */
export function cssFilterFor(look: Look): string {
  const a = { ...NEUTRAL_LOOK, ...look };
  const parts = [
    `brightness(${(1 + a.brightness + a.fade * 0.08).toFixed(3)})`,
    `contrast(${(1 + a.contrast / 100 - a.fade * 0.25).toFixed(3)})`,
    `saturate(${Math.max(0, 1 + a.saturation).toFixed(3)})`,
  ];
  if (a.grayscale) parts.push("grayscale(1)");
  if (a.sepia) parts.push("sepia(0.85)");
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.blur) parts.push(`blur(${Math.min(2, a.blur / 2)}px)`);
  return parts.join(" ");
}

/** CSS background for a tint overlay on a thumbnail chip. */
export function cssTintFor(look: Look): { background: string; mixBlendMode: TintBlend } | null {
  const t = look.tint;
  if (!t) return null;
  const n = parseInt(t.color.replace("#", ""), 16);
  return { background: `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${t.alpha})`, mixBlendMode: t.blend };
}
