import { ExternalLink } from "lucide-react";
import type { InboundMessage } from "@socmedia/shared";
import { Badge, PlatformIcon } from "@/components/ui";
import { relativeTime } from "@/lib/utils";
import { MESSAGE_STATUS_LABEL, MESSAGE_STATUS_TONE, TIMELINE_STATUS_LABEL, mediaCountLabel, timelineMessageIsRedundant } from "./inboundUtils";

/** Timeline, publish links and the bot's reply for one inbound message. Shared by the setup wizard's
 * "send a test" step and the inbound monitor's expanded row. */
export function InboundMessagePreview({ message }: { message: InboundMessage }) {
  return (
    <div className="space-y-3" data-testid="inbound-message-preview">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={MESSAGE_STATUS_TONE[message.status]} dot>{MESSAGE_STATUS_LABEL[message.status]}</Badge>
        <span className="text-xs text-ink-500">{mediaCountLabel(message.mediaCount)}</span>
        {message.hasAudio && <span className="text-xs text-ink-500">Voice note</span>}
      </div>
      {message.text ? (
        <p className="text-sm text-ink-800">{message.text}</p>
      ) : (
        <p className="text-sm italic text-ink-400">No caption</p>
      )}

      <ol className="space-y-1.5 border-l border-ink-200 pl-3" aria-label="Timeline">
        {message.timeline.map((entry, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-500">
            <span className="font-medium text-ink-700">{TIMELINE_STATUS_LABEL[entry.status] ?? entry.status.replace(/_/g, " ")}</span>
            {!timelineMessageIsRedundant(entry) && <span className="text-ink-500">{entry.message}</span>}
            <time dateTime={entry.at} className="text-ink-400">{relativeTime(entry.at)}</time>
          </li>
        ))}
      </ol>

      {message.links.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Published to">
          {message.links.map((link) =>
            link.url ? (
              <a key={link.connectionId} href={link.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-xs">
                <PlatformIcon platform={link.platform} size={16} /> {link.label ?? link.platform} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : (
              <span key={link.connectionId} className="inline-flex items-center gap-1 text-xs text-ink-500">
                <PlatformIcon platform={link.platform} size={16} mono /> {link.label ?? link.platform}: {link.status}
              </span>
            ),
          )}
        </div>
      )}

      {message.reply && (
        <div className="notice-info">
          <p className="font-medium text-ink-700">Reply from the {message.repliedBy === "agent" ? "agent" : "system"}</p>
          <p className="mt-1 whitespace-pre-wrap">{message.reply}</p>
        </div>
      )}

      {message.error && <p className="notice-danger" role="alert"><span className="font-medium">Error:</span> {message.error}</p>}
    </div>
  );
}
