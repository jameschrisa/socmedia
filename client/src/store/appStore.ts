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
  /** Route the console page returns to when closed; set right before navigating to /console. */
  consoleReturnTo: string;
  setConsoleReturnTo: (path: string) => void;
  /** Width of the Agent pane as a fraction of the split view, clamped to [CONSOLE_SPLIT_MIN, CONSOLE_SPLIT_MAX]. */
  consoleSplit: number;
  setConsoleSplit: (ratio: number) => void;
  consoleHistory: string[];
  pushConsoleHistory: (cmd: string) => void;
}

export const CONSOLE_SPLIT_MIN = 0.3;
export const CONSOLE_SPLIT_MAX = 0.7;
export const CONSOLE_SPLIT_DEFAULT = 0.5;
const CONSOLE_HISTORY_MAX = 50;

function clampSplit(ratio: number): number {
  return Math.min(CONSOLE_SPLIT_MAX, Math.max(CONSOLE_SPLIT_MIN, ratio));
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
      consoleReturnTo: "/",
      setConsoleReturnTo: (path) => set({ consoleReturnTo: path || "/" }),
      consoleSplit: CONSOLE_SPLIT_DEFAULT,
      setConsoleSplit: (ratio) => set({ consoleSplit: clampSplit(ratio) }),
      consoleHistory: [],
      pushConsoleHistory: (cmd) => set((s) => ({ consoleHistory: [cmd, ...s.consoleHistory.filter((c) => c !== cmd)].slice(0, CONSOLE_HISTORY_MAX) })),
    }),
    {
      name: "pulse-app",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        currentOrgId: s.currentOrgId, calendarView: s.calendarView, theme: s.theme,
        consoleSplit: s.consoleSplit, consoleHistory: s.consoleHistory,
      }),
    },
  ),
);
