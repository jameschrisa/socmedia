import { Fragment, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronRight, FlaskConical, Phone, type LucideIcon } from "lucide-react";
import type { InboundChannel, InboundMessage } from "@socmedia/shared";
import { Badge, Button } from "@/components/ui";
import { useInboundBindings, useInboundMessageMutations, useInboundMessages, useInboundStream } from "@/hooks/useInbound";
import { relativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { InboundMessagePreview } from "./InboundMessagePreview";
import { CHANNEL_SHORT_LABEL, MESSAGE_STATUS_LABEL, MESSAGE_STATUS_TONE, senderDisplayName } from "./inboundUtils";

const CHANNEL_ICON: Record<InboundChannel, LucideIcon> = { twilio: Phone, telegram: Bot, test: FlaskConical };
const MAX_ROWS = 50;
const HIGHLIGHT_MS = 2500;

/** Live table of recent inbound messages: seeded once from the REST endpoint, then kept current from
 * the SSE stream. New arrivals are prepended with a brief highlight. Below `sm` the table stacks into
 * cards (see `.inbound-stack-table` in styles.css) so status and actions stay on screen. */
export function InboundMonitor() {
  const messagesQuery = useInboundMessages({ limit: MAX_ROWS });
  const { data: bindings = [] } = useInboundBindings();
  const { confirm, discard } = useInboundMessageMutations();
  const [rows, setRows] = useState<InboundMessage[]>([]);
  const [highlighted, setHighlighted] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  // Seed from the initial fetch exactly once, merging rather than replacing: the request can resolve
  // after the stream has already delivered a message, and a plain overwrite would drop it.
  const seededRef = useRef(false);

  useEffect(() => {
    if (!messagesQuery.data || seededRef.current) return;
    seededRef.current = true;
    setRows((old) => {
      const known = new Set(old.map((m) => m.id));
      const merged = [...old, ...messagesQuery.data.filter((m) => !known.has(m.id))];
      return merged.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)).slice(0, MAX_ROWS);
    });
  }, [messagesQuery.data]);

  const { status } = useInboundStream({
    enabled: true,
    onEvent: (event) => {
      if (event.type !== "message") return;
      const msg = event.message;
      setRows((old) => {
        const exists = old.some((m) => m.id === msg.id);
        const next = exists ? old.map((m) => (m.id === msg.id ? msg : m)) : [msg, ...old];
        return next.slice(0, MAX_ROWS);
      });
      setHighlighted((old) => ({ ...old, [msg.id]: true }));
      setTimeout(() => setHighlighted((old) => { const { [msg.id]: _drop, ...rest } = old; return rest; }), HIGHLIGHT_MS);
    },
  });

  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink-900">Recent messages</h4>
        <span className="flex items-center gap-1.5 text-xs text-ink-500" data-testid="monitor-listening" role="status" aria-live="polite">
          <span className={cn("h-1.5 w-1.5 rounded-full", status === "open" ? "bg-green-500" : "bg-ink-400 animate-pulse")} aria-hidden />
          {status === "open" ? "Listening" : "Connecting…"}
        </span>
      </div>

      {messagesQuery.isLoading && rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-500">Loading messages…</p>
      ) : messagesQuery.isError && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-ink-500">
          <p>Could not load recent messages.</p>
          <Button size="sm" variant="outline" onClick={() => messagesQuery.refetch()}>Retry</Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-ink-500">
          <p className="font-medium text-ink-700">No messages yet</p>
          <p className="mt-1">Once a linked sender texts or messages a photo, it shows up here live with what suprstar did with it.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="inbound-stack-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-500">
                <th className="py-2 pr-3 font-medium">Channel</th>
                <th className="py-2 pr-3 font-medium">From</th>
                <th className="py-2 pr-3 font-medium">Message</th>
                <th className="py-2 pr-3 font-medium">Media</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Received</th>
                <th className="py-2"><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const Icon = CHANNEL_ICON[m.channel];
                const isOpen = expanded === m.id;
                const detailsId = `inbound-message-details-${m.id}`;
                return (
                  <Fragment key={m.id}>
                    <tr
                      className={cn("cursor-pointer border-b border-ink-100 transition-colors last:border-0 hover:bg-ink-50", highlighted[m.id] && "bg-brand-50", isOpen && "bg-ink-50")}
                      onClick={() => toggle(m.id)}
                      data-testid="inbound-message-row"
                      data-status={m.status}
                    >
                      <td className="cell-channel py-2.5 pr-3"><Icon className="h-4 w-4 text-ink-500" aria-label={CHANNEL_SHORT_LABEL[m.channel]} /></td>
                      <td className="cell-from py-2.5 pr-3 text-ink-800">{senderDisplayName(m, bindings)}</td>
                      <td className="cell-message max-w-[16rem] truncate py-2.5 pr-3 text-ink-600">{m.text || <span className="italic text-ink-400">No caption</span>}</td>
                      <td className="cell-media py-2.5 pr-3 text-ink-600">{m.mediaCount}</td>
                      <td className="cell-status py-2.5 pr-3"><Badge tone={MESSAGE_STATUS_TONE[m.status]} dot>{MESSAGE_STATUS_LABEL[m.status]}</Badge></td>
                      <td className="cell-received py-2.5 pr-3 text-ink-500"><time dateTime={m.receivedAt}>{relativeTime(m.receivedAt)}</time></td>
                      <td className="cell-toggle py-1 pr-1 text-ink-400">
                        <button
                          type="button"
                          className="focus-ring inbound-tap flex h-8 w-8 items-center justify-center hover:text-ink-700"
                          aria-expanded={isOpen}
                          aria-controls={isOpen ? detailsId : undefined}
                          aria-label={isOpen ? "Hide details" : "Show details"}
                          onClick={(e) => { e.stopPropagation(); toggle(m.id); }}
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="details-row border-b border-ink-100 bg-ink-50 last:border-0" id={detailsId}>
                        <td colSpan={7} className="px-3 py-4">
                          <InboundMessagePreview message={m} />
                          {m.status === "awaiting_confirmation" && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button size="sm" className="inbound-tap" onClick={() => confirm.mutate(m.id)} loading={confirm.isPending} data-testid="confirm-message">Confirm</Button>
                              <Button size="sm" variant="outline" className="inbound-tap" onClick={() => discard.mutate(m.id)} loading={discard.isPending} data-testid="discard-message">Discard</Button>
                              <span className="self-center text-xs text-ink-500">Confirm posts it now; Discard drops it.</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
