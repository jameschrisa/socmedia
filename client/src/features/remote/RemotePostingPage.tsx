import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Copy, Send, Smartphone } from "lucide-react";
import { SegmentedTabs, type TabItem } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { QuickPostSection } from "./QuickPostSection";
import { InboundSection } from "./inbound/InboundSection";
import { InboundMonitor } from "./inbound/InboundMonitor";
import { InboundBindingsTable } from "./inbound/InboundBindingsTable";
import { RemoteOverviewTab } from "./RemoteOverviewTab";
import { RemotePostsTable } from "./RemotePostsTable";
import { REMOTE_TAB_FOR_HASH, REMOTE_TAB_HASH, type RemoteTab } from "./remoteUtils";

const TABS: TabItem<RemoteTab>[] = [
  { id: "overview", label: "Overview" },
  { id: "phone", label: "Phone links" },
  { id: "chat", label: "Chat channels" },
  { id: "posts", label: "Remote posts" },
];

/** Three-step strip explaining phone links, shown above the "Phone links" tab content. */
function HowItWorksStrip() {
  const steps = [
    { icon: <Copy className="h-4 w-4" />, label: "Create a link" },
    { icon: <Smartphone className="h-4 w-4" />, label: "Open it on your phone" },
    { icon: <Send className="h-4 w-4" />, label: "Snap, caption, post" },
  ];
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4" data-testid="how-it-works" aria-label="How phone links work">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-2 text-sm text-ink-700">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-brand-50 text-brand-600" aria-hidden>{step.icon}</span>
          {step.label}
          {i < steps.length - 1 && <ArrowRight className="hidden h-3.5 w-3.5 text-ink-300 sm:inline" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

/** Generic (token-less) reminder of the iOS Shortcut recipe, always visible on the Phone links tab so it
 * doesn't only appear once, right after creating a link. */
function IosShortcutHelp() {
  return (
    <div className="notice-info" data-testid="ios-shortcut-help">
      <p className="font-medium text-ink-700">iOS Shortcut</p>
      <p className="mt-1">Use a Shortcuts "Get Contents of URL" step with method POST and a form-multipart body:</p>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all bg-ink-100 p-2 text-[11px]">{`curl -F "image=@IMG_0001.jpg" -F "caption=Your caption" "${window.location.origin}/api/quick/YOUR_TOKEN"`}</pre>
      <p className="mt-1 text-[11px] text-ink-500">YOUR_TOKEN is the last part of a link's address, after /go/. suprstar shows it once, when you create the link.</p>
    </div>
  );
}

function PhoneLinksTab() {
  return (
    <div className="space-y-6">
      <HowItWorksStrip />
      <QuickPostSection />
      <IosShortcutHelp />
    </div>
  );
}

function ChatChannelsTab({ canManage }: { canManage: boolean }) {
  if (!canManage) {
    // Editors may read messages and manage their own linked senders (the server allows both); only
    // channel setup (credentials, webhooks, transcription) is reserved for owners and admins.
    return (
      <div className="space-y-6">
        <div className="card p-6 text-sm text-ink-500" data-testid="chat-channels-read-only">
          Setting up chat channels needs settings access. Ask an owner or admin to configure a channel here. You can still watch
          incoming messages and manage linked senders below.
        </div>
        <div className="card p-5">
          <h3 className="mb-1 text-base font-semibold text-ink-900">Recent messages</h3>
          <p className="mb-4 text-xs text-ink-500">Everything that arrived from a linked phone or chat, with what suprstar did about it.</p>
          <InboundMonitor />
        </div>
        <div className="card p-5">
          <h3 className="mb-1 text-base font-semibold text-ink-900">Linked senders</h3>
          <p className="mb-4 text-xs text-ink-500">Phones and chats allowed to post through the configured channels.</p>
          <InboundBindingsTable />
        </div>
      </div>
    );
  }
  return <InboundSection />;
}

/** Reads the active tab from the URL hash and keeps the hash in sync when the tab changes, so links like
 * `/remote#chat` (the right-rail Inbound popover, the setup wizard) land on the right tab from anywhere. */
function useHashTab(defaultTab: RemoteTab): [RemoteTab, (tab: RemoteTab) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<RemoteTab>(() => REMOTE_TAB_FOR_HASH[location.hash] ?? defaultTab);

  useEffect(() => {
    const next = REMOTE_TAB_FOR_HASH[location.hash];
    if (next) setTab(next);
  }, [location.hash]);

  const selectTab = (next: RemoteTab) => {
    setTab(next);
    navigate({ pathname: location.pathname, hash: REMOTE_TAB_HASH[next] }, { replace: true });
  };

  return [tab, selectTab];
}

/** Top-level "Remote Posting" page: post from a phone, a text message or a chat, and keep an eye on
 * what came in. Visible to anyone with write access; setting up chat channels still needs settings access. */
export function RemotePostingPage() {
  const { can } = useAuth();
  const [tab, selectTab] = useHashTab("overview");
  const tabsRef = useRef<HTMLDivElement>(null);

  /** Arrow keys, Home and End move between the page tabs (WAI-ARIA tabs pattern) and keep focus on the
   * newly selected tab. The shared SegmentedTabs only handles clicks. */
  const onTabsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((t) => t.id === tab);
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    selectTab(TABS[next].id);
    requestAnimationFrame(() => tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus());
  };

  if (!can.write) {
    return (
      <div className="space-y-2">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Remote Posting</h1>
          <p className="mt-1 text-sm text-ink-500">Post from a phone, a text message or a chat, and keep an eye on what came in.</p>
        </div>
        <div className="card p-6 text-sm text-ink-500" data-testid="remote-read-only">
          You don't have access to post from a phone or a chat. Ask an editor, admin or owner for a hand.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Remote Posting</h1>
        <p className="mt-1 text-sm text-ink-500">Post from a phone, a text message or a chat, and keep an eye on what came in.</p>
      </div>

      <div ref={tabsRef} className="remote-tabs" data-testid="remote-tabs" onKeyDown={onTabsKeyDown}>
        <SegmentedTabs<RemoteTab> value={tab} onChange={selectTab} items={TABS} size="md" />
      </div>

      {tab === "overview" && <RemoteOverviewTab onNavigate={selectTab} />}
      {tab === "phone" && <PhoneLinksTab />}
      {tab === "chat" && <ChatChannelsTab canManage={can.manageSettings} />}
      {tab === "posts" && <RemotePostsTable />}
    </div>
  );
}
