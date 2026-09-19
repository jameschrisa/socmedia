import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, Plus, Activity } from "lucide-react";
import { OrgSwitcher } from "./OrgSwitcher";
import { Button } from "@/components/ui";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/", label: "Overview", end: true },
  { to: "/calendar", label: "Calendar" },
  { to: "/studio", label: "Studio" },
  { to: "/connections", label: "Social Profiles" },
  { to: "/analytics", label: "Analytics" },
  { to: "/settings", label: "Settings" },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-sm">
        <Activity className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
      </span>
      <span className="font-display text-xl text-ink-900">Pulse</span>
    </div>
  );
}

export function TopNav() {
  const openComposer = useAppStore((s) => s.openComposer);
  const toggleAi = useAppStore((s) => s.toggleAiPanel);
  return (
    <header className="sticky top-0 z-30 glass-sheet border-x-0 border-t-0 rounded-none">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between gap-4">
          <Logo />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" icon={<Sparkles className="h-4 w-4 text-brand-500" />} onClick={toggleAi} data-testid="ai-toggle">AI Assistant</Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openComposer(null)} data-testid="new-post">New post</Button>
            <OrgSwitcher />
          </div>
        </div>
        <nav className="-mb-px flex gap-1 overflow-x-auto no-scrollbar" aria-label="Primary">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => cn("relative whitespace-nowrap px-3.5 py-3 text-sm font-medium transition-colors", isActive ? "text-brand-600" : "text-ink-500 hover:text-ink-900")}
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
