import { MessageSquare, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui";
import { REMOTE_SOURCE_LABEL, type RemoteSource } from "./remoteUtils";

/** Where a remote post came from. Both sources share the neutral tone so colour stays reserved for
 * status badges; the icon carries the distinction, which also reads without colour. */
export function SourceBadge({ source, className }: { source: RemoteSource; className?: string }) {
  const Icon = source === "phone" ? Smartphone : MessageSquare;
  return (
    <Badge tone="neutral" className={className}>
      <Icon className="h-3 w-3" aria-hidden />
      {REMOTE_SOURCE_LABEL[source]}
    </Badge>
  );
}
