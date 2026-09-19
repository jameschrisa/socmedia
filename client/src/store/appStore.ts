import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ViewMode = "month" | "week";
export type ThemePref = "dark" | "light" | "system";

interface AppState {
  currentOrgId: string | null;
  setCurrentOrgId: (id: string | null) => void;
  calendarView: ViewMode;
  setCalendarView: (v: ViewMode) => void;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  aiPanelOpen: boolean;
  setAiPanelOpen: (open: boolean) => void;
  toggleAiPanel: () => void;
  composerPostId: string | null;      // post being edited in the composer drawer
  composerOpen: boolean;
  openComposer: (postId?: string | null, defaults?: Partial<ComposerDefaults>) => void;
  closeComposer: () => void;
  composerDefaults: ComposerDefaults;
  consoleOpen: boolean;
  setConsoleOpen: (open: boolean) => void;
  toggleConsole: () => void;
  consoleHeight: number;
  setConsoleHeight: (h: number) => void;
  consoleHistory: string[];
  pushConsoleHistory: (cmd: string) => void;
}

export const CONSOLE_MIN_HEIGHT = 160;
export const CONSOLE_DEFAULT_HEIGHT = 320;
const CONSOLE_HISTORY_MAX = 50;

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
      theme: "dark",
      setTheme: (theme) => set({ theme }),
      aiPanelOpen: false,
      setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
      toggleAiPanel: () => set({ aiPanelOpen: !get().aiPanelOpen }),
      composerPostId: null,
      composerOpen: false,
      composerDefaults: emptyDefaults,
      openComposer: (postId = null, defaults = {}) => set({ composerOpen: true, composerPostId: postId, composerDefaults: { ...emptyDefaults, ...defaults } }),
      closeComposer: () => set({ composerOpen: false, composerPostId: null, composerDefaults: emptyDefaults }),
      consoleOpen: false,
      setConsoleOpen: (open) => set({ consoleOpen: open }),
      toggleConsole: () => set({ consoleOpen: !get().consoleOpen }),
      consoleHeight: CONSOLE_DEFAULT_HEIGHT,
      setConsoleHeight: (h) => set({ consoleHeight: Math.max(CONSOLE_MIN_HEIGHT, h) }),
      consoleHistory: [],
      pushConsoleHistory: (cmd) => set((s) => ({ consoleHistory: [cmd, ...s.consoleHistory.filter((c) => c !== cmd)].slice(0, CONSOLE_HISTORY_MAX) })),
    }),
    {
      name: "pulse-app",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        currentOrgId: s.currentOrgId, calendarView: s.calendarView, theme: s.theme,
        consoleOpen: s.consoleOpen, consoleHeight: s.consoleHeight, consoleHistory: s.consoleHistory,
      }),
    },
  ),
);
