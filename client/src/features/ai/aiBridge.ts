import { create } from "zustand";
import type { CaptionVariant, ContentIdea, Platform } from "@socmedia/shared";

/**
 * Cross-feature channel between the AI Assistant and the Composer.
 * The AI panel pushes a suggestion; the composer consumes it (and clears it).
 */
export interface AiSuggestion {
  kind: "caption" | "idea" | "hashtags";
  caption?: string;
  hashtags?: string[];
  title?: string;
  platform?: Platform;
  idea?: ContentIdea;
  variant?: CaptionVariant;
  createdAt: number;
}

interface AiBridgeState {
  pending: AiSuggestion | null;
  push: (s: Omit<AiSuggestion, "createdAt">) => void;
  consume: () => AiSuggestion | null;
  /** Context the composer shares with the AI panel so prompts are pre-filled. */
  context: { brief: string; platforms: Platform[]; caption: string };
  setContext: (ctx: Partial<AiBridgeState["context"]>) => void;
}

export const useAiBridge = create<AiBridgeState>()((set, get) => ({
  pending: null,
  push: (s) => set({ pending: { ...s, createdAt: Date.now() } }),
  consume: () => { const p = get().pending; set({ pending: null }); return p; },
  context: { brief: "", platforms: [], caption: "" },
  setContext: (ctx) => set({ context: { ...get().context, ...ctx } }),
}));
