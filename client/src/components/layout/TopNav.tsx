import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Sun, Moon, Monitor, Terminal } from "lucide-react";
import { OrgSwitcher } from "./OrgSwitcher";
import { Button, SparkMark, Wordmark } from "@/components/ui";
import { useAppStore } from "@/store/appStore";
import { useAuth } from "@/hooks/useAuth";
import { useOpenConsole } from "@/features/console/useConsoleNav";
import { UserMenu } from "@/features/auth/UserMenu";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/", label: "Overview", end: true },
  { to: "/calendar", label: "Calendar" },
  { to: "/studio", label: "Studio" },
  { to: "/remote", label: "Remote Posting", requires: "write" as const },
  { to: "/assistant", label: "AI Assistant", requires: "write" as const },
  { to: "/connections", label: "Social Profiles" },
  { to: "/analytics", label: "Analytics" },
  { to: "/settings", label: "Settings" },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <SparkMark size={24} />
      <Wordmark />
    </div>
  );
}

export function TopNav() {
  const openComposer = useAppStore((s) => s.openComposer);
  const openConsole = useOpenConsole();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const { can } = useAuth();
  const nextTheme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <header className="sticky top-0 z-30 glass-sheet border-x-0 border-t-0 rounded-none">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <div className="flex h-14 items-center justify-between gap-2 sm:gap-4">
          <Logo />
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setTheme(nextTheme)}
              aria-label={`Theme: ${theme}. Switch to ${nextTheme}`}
              title={`Theme: ${theme} (click for ${nextTheme})`}
              data-testid="theme-toggle"
              className="hidden h-8 w-8 items-center justify-center glass-veil text-ink-800 hover:bg-glass-strong sm:inline-flex"
            >
              <ThemeIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={openConsole}
              aria-label="Console"
              title="Console (Ctrl+`)"
              data-testid="rail-console-mobile"
              className="inline-flex h-8 w-8 items-center justify-center glass-veil text-ink-800 hover:bg-glass-strong lg:hidden"
            >
              <Terminal className="h-4 w-4" />
            </button>
            {can.write && (
              <>
                <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openComposer(null)} data-testid="new-post" aria-label="New post" title="New post">
                  <span className="hidden sm:inline">New post</span>
                </Button>
              </>
            )}
            <OrgSwitcher />
            <UserMenu />
          </div>
        </div>
        <nav className="-mb-px flex gap-1 overflow-x-auto no-scrollbar" aria-label="Primary">
          {tabs.filter((t) => !t.requires || can[t.requires]).map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => cn("relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors", isActive ? "text-ink-900" : "text-ink-800 hover:text-ink-900")}
            >
              {({ isActive }) => (
                <>
                  {t.label}
                  {isActive && <motion.span layoutId="nav-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
