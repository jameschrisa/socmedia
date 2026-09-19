import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ViewMode = "month" | "week";

interface AppState {
  currentOrgId: string | null;
  setCurrentOrgId: (id: string | null) => void;
  calendarView: ViewMode;
  setCalendarView: (v: ViewMode) => void;
  aiPanelOpen: boolean;
  setAiPanelOpen: (open: boolean) => void;
  toggleAiPanel: () => void;
  composerPostId: string | null;      // post being edited in the composer drawer
  composerOpen: boolean;
  openComposer: (postId?: string | null, defaults?: Partial<ComposerDefaults>) => void;
  closeComposer: () => void;
  composerDefaults: ComposerDefaults;
}

export interface ComposerDefaults {
  scheduledAt: string | null;
  mediaIds: string[];
}

const emptyDefaults: ComposerDefaults = { scheduledAt: null, mediaIds: [] };

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentOrgId: null,
      setCurrentOrgId: (id) => set({ currentOrgId: id }),
      calendarView: "month",
      setCalendarView: (v) => set({ calendarView: v }),
      aiPanelOpen: false,
      setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
      toggleAiPanel: () => set({ aiPanelOpen: !get().aiPanelOpen }),
      composerPostId: null,
      composerOpen: false,
      composerDefaults: emptyDefaults,
      openComposer: (postId = null, defaults = {}) => set({ composerOpen: true, composerPostId: postId, composerDefaults: { ...emptyDefaults, ...defaults } }),
      closeComposer: () => set({ composerOpen: false, composerPostId: null, composerDefaults: emptyDefaults }),
    }),
    {
      name: "pulse-app",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ currentOrgId: s.currentOrgId, calendarView: s.calendarView }),
    },
  ),
);
