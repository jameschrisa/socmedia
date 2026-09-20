import { create } from "zustand";
import type { CaptionResponse, IdeaResponse, Platform } from "@socmedia/shared";

export type AiTabId = "captions" | "ideas" | "hashtags" | "improve" | "bestTimes";

export interface HashtagsResult {
  hashtags: string[];
  model: string;
  mock: boolean;
}

export interface ImproveResult {
  before: string;
  caption: string;
  hashtags: string[];
  model: string;
  mock: boolean;
  platform: Platform;
}

export interface AiHistoryEntry {
  id: string;
  tab: AiTabId;
  createdAt: number;
  mock: boolean;
  label: string;
}

interface AiStoreState {
  /** Which tab is currently visible; lets one tab drive another (e.g. "Improve…"). */
  activeTab: AiTabId;
  setActiveTab: (tab: AiTabId) => void;

  /** True when the most recent AI response of any kind was served by the offline mock. */
  lastMock: boolean;
  setLastMock: (mock: boolean) => void;

  /** Rolling log of the last 10 generations across all tabs. */
  history: AiHistoryEntry[];
  addHistory: (entry: Omit<AiHistoryEntry, "id" | "createdAt">) => void;

  /** Last result per tab, kept here (not component state) so switching tabs never loses it. */
  captionsResult: CaptionResponse | null;
  setCaptionsResult: (result: CaptionResponse | null) => void;

  ideasResult: IdeaResponse | null;
  setIdeasResult: (result: IdeaResponse | null) => void;

  hashtagsResult: HashtagsResult | null;
  setHashtagsResult: (result: HashtagsResult | null) => void;

  improveResult: ImproveResult | null;
  setImproveResult: (result: ImproveResult | null) => void;

  /** One-shot seed used when another tab hands work off to Captions/Improve. */
  captionsBriefSeed: string | null;
  setCaptionsBriefSeed: (value: string | null) => void;

  improveSeed: { caption: string; platform?: Platform } | null;
  setImproveSeed: (value: { caption: string; platform?: Platform } | null) => void;
}

let historySeq = 0;

export const useAiStore = create<AiStoreState>()((set, get) => ({
  activeTab: "captions",
  setActiveTab: (tab) => set({ activeTab: tab }),

  lastMock: false,
  setLastMock: (mock) => set({ lastMock: mock }),

  history: [],
  addHistory: (entry) =>
    set({
      history: [{ ...entry, id: `ai-hist-${Date.now()}-${historySeq++}`, createdAt: Date.now() }, ...get().history].slice(0, 10),
    }),

  captionsResult: null,
  setCaptionsResult: (result) => set({ captionsResult: result }),

  ideasResult: null,
  setIdeasResult: (result) => set({ ideasResult: result }),

  hashtagsResult: null,
  setHashtagsResult: (result) => set({ hashtagsResult: result }),

  improveResult: null,
  setImproveResult: (result) => set({ improveResult: result }),

  captionsBriefSeed: null,
  setCaptionsBriefSeed: (value) => set({ captionsBriefSeed: value }),

  improveSeed: null,
  setImproveSeed: (value) => set({ improveSeed: value }),
}));
