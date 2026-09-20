import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Eye, EyeOff, Plus } from "lucide-react";
import type { InboundChannel, InboundTranscriptionSettings } from "@socmedia/shared";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Select, Skeleton } from "@/components/ui";
import { useInboundChannels, useInboundStatus, useInboundTranscription } from "@/hooks/useInbound";
import { ApiError } from "@/lib/api";
import { cn, relativeTime } from "@/lib/utils";
import { InboundBindingsTable } from "./InboundBindingsTable";
import { InboundMonitor } from "./InboundMonitor";
import { InboundWizard } from "./InboundWizard";
import { CHANNEL_LABEL, CHANNEL_STATE_DOT, CHANNEL_STATE_LABEL } from "./inboundUtils";

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong";
}

type Provider = InboundTranscriptionSettings["provider"];

const PROVIDER_KEY_HINT: Record<Provider, string> = {
  none: "",
  openai: "An OpenAI API key with access to the Whisper model.",
  deepgram: "A Deepgram API key.",
};

/** Provider + key row: turns voice notes sent to a linked chat into captions. */
function TranscriptionRow() {
  const { data, isLoading, isError, refetch, save } = useInboundTranscription();
  const [provider, setProvider] = useState<Provider>("none");
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) { setProvider(data.provider); setApiKey(data.apiKey ?? ""); }
  }, [data, dirty]);

  const submit = () => {
    save.mutate(
      { provider, apiKey: apiKey || undefined },
      {
        onSuccess: (d) => { setDirty(false); setProvider(d.provider); setApiKey(d.apiKey ?? ""); toast.success("Transcription settings saved"); },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  if (isLoading) return <Skeleton className="h-12" />;
  if (isError || !data) {
    return (
      <div className="flex items-center gap-3 border-t border-ink-100 pt-4 text-sm text-ink-500">
        Could not load transcription settings.
        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const keyMissing = provider !== "none" && !apiKey.trim();
  const keyStored = data.configured && data.provider === provider && !dirty;

  return (
    <div className="border-t border-ink-100 pt-4" data-testid="transcription-row">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Voice transcription" htmlFor="transcription-provider" hint="Turns voice notes sent to a linked chat into captions." className="w-full sm:w-auto">
          <Select
            id="transcription-provider"
            value={provider}
            onChange={(e) => { setProvider(e.target.value as Provider); setDirty(true); }}
          >
            <option value="none">None</option>
            <option value="openai">OpenAI Whisper</option>
            <option value="deepgram">Deepgram</option>
          </Select>
        </Field>
        {provider !== "none" && (
          <Field
            label="API key"
            htmlFor="transcription-key"
            className="min-w-[14rem] flex-1"
            hint={keyStored ? "A key is stored; paste a new one to replace it." : PROVIDER_KEY_HINT[provider]}
          >
            <div className="relative">
              <Input
                id="transcription-key" type={reveal ? "text" : "password"} className="pr-10 font-mono"
                value={apiKey} onChange={(e) => { setApiKey(e.target.value); setDirty(true); }} autoComplete="off" spellCheck={false}
                aria-invalid={dirty && keyMissing ? true : undefined}
              />
              <button
                type="button"
                aria-label={reveal ? "Hide key" : "Show key"}
                aria-pressed={reveal}
                onClick={() => setReveal((r) => !r)}
                className="focus-ring absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-400 hover:text-ink-700"
              >
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
        )}
        <Button size="sm" className="inbound-tap" disabled={!dirty || keyMissing} loading={save.isPending} onClick={submit} data-testid="save-transcription">Save</Button>
      </div>
      {dirty && keyMissing && <p className="mt-2 text-xs text-amber-700">Paste an API key to save this provider.</p>}
    </div>
  );
}

/** Settings section: configure inbound chat channels (Twilio, Telegram, Test), link senders, watch
 * messages arrive live, and manage which senders can post. */
export function InboundSection() {
  const status = useInboundStatus();
  const channelsQuery = useInboundChannels();
  const location = useLocation();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardChannel, setWizardChannel] = useState<InboundChannel | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);

  const openWizard = (channel?: InboundChannel) => { setWizardChannel(channel ?? null); setWizardOpen(true); };
  const goToMonitor = () => monitorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const channels = channelsQuery.data ?? [];
  const channelStatuses = status.data?.channels ?? [];

  // "/settings#inbound" (the right-rail popover's "Open settings" link) lands on this card, even when the
  // page was already open. React Router does not scroll to hashes on its own.
  useEffect(() => {
    if (location.hash !== "#inbound" || !cardRef.current) return;
    cardRef.current.scrollIntoView({ block: "start" });
  }, [location.hash, location.key]);

  return (
    <div ref={cardRef} className="scroll-mt-28">
    <Card data-testid="inbound-section">
      <CardHeader
        title="Post from chat"
        subtitle="Let your team post a photo by texting or messaging a bot. suprstar drafts or publishes it automatically."
        action={<Button size="sm" className="inbound-tap shrink-0" icon={<Plus className="h-4 w-4" />} onClick={() => openWizard()} data-testid="setup-channel">Set up a channel</Button>}
      />
      <CardBody className="space-y-5">
        {status.isLoading ? (
          <Skeleton className="h-14" />
        ) : status.isError ? (
          <div className="flex items-center gap-3 text-sm text-ink-500">
            Could not load channel status.
            <Button size="sm" variant="outline" onClick={() => status.refetch()}>Retry</Button>
          </div>
        ) : channelStatuses.length === 0 ? (
          <p className="text-sm text-ink-500">No channels configured yet. Set up Twilio, Telegram or the test channel to get started.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="inbound-channel-chips" aria-label="Channels">
            {channelStatuses.map((c) => (
              <li
                key={c.channel}
                className={cn(
                  "flex w-full flex-wrap items-center gap-x-2 gap-y-1 border px-3 py-1.5 text-xs sm:w-auto",
                  c.state === "error" ? "border-red-200" : "border-ink-200",
                )}
                data-testid={`inbound-chip-${c.channel}`}
                title={c.detail ?? undefined}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CHANNEL_STATE_DOT[c.state])} aria-hidden />
                <span className="font-medium text-ink-800">{CHANNEL_LABEL[c.channel]}</span>
                <Badge tone={c.state === "listening" ? "success" : c.state === "error" ? "danger" : "neutral"}>{CHANNEL_STATE_LABEL[c.state]}</Badge>
                <span className="flex items-center gap-x-2 whitespace-nowrap text-ink-400">
                  {c.state === "error" && c.detail && <span className="text-red-600">{c.detail}</span>}
                  {c.lastEventAt && <span>active {relativeTime(c.lastEventAt)}</span>}
                  <span>{c.counts.today} today</span>
                  {c.counts.pending > 0 && <span className="text-amber-700">{c.counts.pending} waiting</span>}
                </span>
                {c.configured ? (
                  <button type="button" className="link focus-ring inbound-tap-inline" onClick={() => openWizard(c.channel)} data-testid={`inbound-edit-${c.channel}`} aria-label={`Edit ${CHANNEL_LABEL[c.channel]}`}>Edit</button>
                ) : (
                  <button type="button" className="link focus-ring inbound-tap-inline" onClick={() => openWizard(c.channel)} aria-label={`Set up ${CHANNEL_LABEL[c.channel]}`}>Set up</button>
                )}
              </li>
            ))}
          </ul>
        )}

        <TranscriptionRow />

        <div ref={monitorRef} className="scroll-mt-28 border-t border-ink-100 pt-4">
          <InboundMonitor />
        </div>

        <div className="border-t border-ink-100 pt-4">
          <h4 className="mb-3 text-sm font-semibold text-ink-900">Linked senders</h4>
          <InboundBindingsTable onRelink={(channel) => openWizard(channel)} />
        </div>
      </CardBody>

      <InboundWizard open={wizardOpen} onClose={() => setWizardOpen(false)} channels={channels} initialChannel={wizardChannel} onFinished={goToMonitor} />
    </Card>
    </div>
  );
}
