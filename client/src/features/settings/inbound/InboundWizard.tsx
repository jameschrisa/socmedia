import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bot, Check, Copy, Eye, EyeOff, FlaskConical, Loader2, Phone, Send,
} from "lucide-react";
import {
  PLATFORM_SPECS, type InboundBinding, type InboundChannel, type InboundChannelConfig, type InboundMessage,
  type Platform, type PlatformConnection, type PublishMode,
} from "@socmedia/shared";
import { Button, Field, Input, Modal, PlatformIcon, SegmentedTabs, Toggle } from "@/components/ui";
import { useConnections } from "@/hooks/useConnections";
import {
  useInboundBindingMutations, useInboundBindings, useInboundChannelMutations, useInboundStream, useInboundTestSend,
} from "@/hooks/useInbound";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { InboundMessagePreview } from "./InboundMessagePreview";
import { CHANNEL_BLURB, CHANNEL_LABEL, generateTestImageDataUrl, isChannelConfigured, maskSenderId } from "./inboundUtils";

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong";
}

const STEP_LABELS = ["Channel", "Credentials", "Link a sender", "Send a test", "Done"] as const;

/** Numbered steps with connectors. Below `sm` only the current step keeps its label, so a phone still
 * shows where you are without the row wrapping. */
function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="mb-5 flex items-center" aria-label="Setup steps">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "upcoming";
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  state === "done" ? "bg-brand-500 text-[color:var(--c-on-brand)]" : state === "current" ? "border-2 border-brand-500 text-brand-500" : "bg-ink-100 text-ink-400",
                )}
                aria-current={state === "current" ? "step" : undefined}
              >
                {state === "done" ? <Check className="h-3.5 w-3.5" aria-label="Completed" /> : n}
              </span>
              <span className={cn("whitespace-nowrap text-xs font-medium", state === "current" ? "inline text-ink-800" : "hidden sm:inline", state === "upcoming" ? "text-ink-400" : "text-ink-800")}>
                {label}
              </span>
            </span>
            {n < STEP_LABELS.length && <span className="mx-2 h-px min-w-[0.75rem] flex-1 bg-ink-200" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

const CHANNEL_CARDS: { id: InboundChannel; icon: React.ReactNode }[] = [
  { id: "twilio", icon: <Phone className="h-5 w-5" /> },
  { id: "telegram", icon: <Bot className="h-5 w-5" /> },
  { id: "test", icon: <FlaskConical className="h-5 w-5" /> },
];

function StepChannel({ value, onChange }: { value: InboundChannel | null; onChange: (c: InboundChannel) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {CHANNEL_CARDS.map(({ id, icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            data-testid={`wizard-channel-${id}`}
            aria-pressed={active}
            className={cn(
              "flex flex-col items-start gap-2 border p-4 text-left transition-colors focus-ring",
              active ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:border-ink-300",
            )}
          >
            <span className={cn("flex h-9 w-9 items-center justify-center", active ? "text-brand-600" : "text-ink-500")}>{icon}</span>
            <span className="text-sm font-semibold text-ink-900">{CHANNEL_LABEL[id]}</span>
            <span className="text-xs text-ink-500">{CHANNEL_BLURB[id]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Show/hide toggle that sits inside a secret input. Full input height so it is a real target on phones. */
function RevealButton({ reveal, onToggle, label }: { reveal: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={reveal ? `Hide ${label}` : `Show ${label}`}
      aria-pressed={reveal}
      onClick={onToggle}
      className="focus-ring absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-400 hover:text-ink-700"
    >
      {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

interface TwilioFormValues { accountSid: string; authToken: string; fromNumber: string }

function TwilioCredentialsForm({ values, onChange, webhookUrl }: { values: TwilioFormValues; onChange: (patch: Partial<TwilioFormValues>) => void; webhookUrl: string }) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(webhookUrl).catch(() => {});
    setCopied(true);
    toast.success("Webhook URL copied");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-4">
      <Field label="Account SID" htmlFor="twilio-sid" hint="Starts with AC; from the Twilio console home page.">
        <Input id="twilio-sid" value={values.accountSid} onChange={(e) => onChange({ accountSid: e.target.value })} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Auth token" htmlFor="twilio-token">
        <div className="relative">
          <Input
            id="twilio-token" type={reveal ? "text" : "password"} className="pr-10 font-mono"
            value={values.authToken} onChange={(e) => onChange({ authToken: e.target.value })} autoComplete="off"
          />
          <RevealButton reveal={reveal} onToggle={() => setReveal((r) => !r)} label="auth token" />
        </div>
      </Field>
      <Field label="From number" htmlFor="twilio-from" hint='E.164, e.g. +15555550123. For WhatsApp, prefix with "whatsapp:", e.g. whatsapp:+15555550123.'>
        <Input id="twilio-from" value={values.fromNumber} onChange={(e) => onChange({ fromNumber: e.target.value })} placeholder="+15555550123" inputMode="tel" />
      </Field>
      <div className="notice-info space-y-2">
        <p className="font-medium text-ink-700">Webhook URL</p>
        <div className="flex items-center gap-2">
          <Input readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Webhook URL" className="font-mono text-xs" data-testid="twilio-webhook-url" />
          <Button type="button" size="sm" variant="outline" className="inbound-tap shrink-0" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={copy}>Copy</Button>
        </div>
        <p>In the Twilio console open your number → Messaging → A message comes in → Webhook, paste this URL, method POST.</p>
        <p>For WhatsApp, open your WhatsApp sandbox settings and paste the same URL as "When a message comes in".</p>
      </div>
    </div>
  );
}

function TelegramCredentialsForm({ token, onChange, savedConfig, justSaved }: { token: string; onChange: (v: string) => void; savedConfig: InboundChannelConfig | null; justSaved: boolean }) {
  const [reveal, setReveal] = useState(false);
  const registered = !!savedConfig?.webhookRegistered;
  const botUsername = savedConfig?.settings.botUsername;
  const tokenRejected = justSaved && !registered && !botUsername;
  const webhookFailed = justSaved && !registered && !!botUsername;
  return (
    <div className="space-y-4">
      <Field label="Bot token" htmlFor="telegram-token">
        <div className="relative">
          <Input
            id="telegram-token" type={reveal ? "text" : "password"} className="pr-10 font-mono"
            value={token} onChange={(e) => onChange(e.target.value)} autoComplete="off" placeholder="123456789:AA…"
          />
          <RevealButton reveal={reveal} onToggle={() => setReveal((r) => !r)} label="bot token" />
        </div>
      </Field>
      <div className="notice-info">Message @BotFather, send /newbot and paste the token it gives you. suprstar registers the webhook for you.</div>
      {registered && (
        <div className="flex items-center gap-2 border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" data-testid="telegram-registered">
          <Check className="h-4 w-4" /> Registered{botUsername ? ` as @${botUsername}` : ""}
        </div>
      )}
      {tokenRejected && (
        <p className="notice-danger" role="alert" data-testid="telegram-rejected">
          Telegram rejected this token. Copy it again from @BotFather (it looks like 123456789:AA…) and save once more.
        </p>
      )}
      {webhookFailed && (
        <p className="notice-warning" role="alert">
          Found @{botUsername}, but Telegram could not register the webhook at {savedConfig?.webhookUrl}. Telegram needs a public HTTPS address; the bot stays off until it can reach suprstar.
        </p>
      )}
    </div>
  );
}

const SENDER_FIELD: Record<InboundChannel, { label: string; placeholder: string; hint?: string }> = {
  twilio: {
    label: "Phone number",
    placeholder: "+15555550123",
    hint: 'E.164 format, e.g. +15555550123. For WhatsApp, use "whatsapp:+15555550123".',
  },
  telegram: {
    label: "Chat id",
    placeholder: "123456789",
    hint: "Send /start to the bot, then use /whoami in the Console or the chat id the bot replies with.",
  },
  test: {
    label: "Name",
    placeholder: "Jordan's phone",
    hint: "Any name; the test channel has no real device.",
  },
};

interface BindingFormValues {
  senderId: string;
  senderLabel: string;
  connectionIds: string[];
  publishMode: PublishMode;
  confirmBeforePosting: boolean;
}

function groupByPlatform(list: PlatformConnection[]): [Platform, PlatformConnection[]][] {
  const map = new Map<Platform, PlatformConnection[]>();
  for (const c of list) {
    const arr = map.get(c.platform) ?? [];
    arr.push(c);
    map.set(c.platform, arr);
  }
  return Array.from(map.entries());
}

function BindingForm({ channel, value, onChange, connections }: {
  channel: InboundChannel;
  value: BindingFormValues;
  onChange: (patch: Partial<BindingFormValues>) => void;
  connections: PlatformConnection[];
}) {
  const field = SENDER_FIELD[channel];
  const grouped = useMemo(
    () => groupByPlatform(connections.filter((c) => PLATFORM_SPECS[c.platform].mediaKinds.includes("image"))),
    [connections],
  );
  const toggleConnection = (id: string) => {
    onChange({ connectionIds: value.connectionIds.includes(id) ? value.connectionIds.filter((c) => c !== id) : [...value.connectionIds, id] });
  };
  const accountsHint = value.connectionIds.length === 0
    ? "Leave all unchecked to post to every enabled image-capable account."
    : `Posts go to ${value.connectionIds.length} selected account${value.connectionIds.length === 1 ? "" : "s"}.`;
  return (
    <div className="space-y-4">
      <Field label={field.label} htmlFor="binding-sender" hint={field.hint}>
        <Input id="binding-sender" value={value.senderId} onChange={(e) => onChange({ senderId: e.target.value })} placeholder={field.placeholder} inputMode={channel === "test" ? "text" : "tel"} />
      </Field>
      <Field label="Label" htmlFor="binding-label" hint="Any name to tell senders apart later.">
        <Input id="binding-label" value={value.senderLabel} onChange={(e) => onChange({ senderLabel: e.target.value })} />
      </Field>
      <Field label="Accounts" hint={accountsHint}>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {grouped.map(([platform, conns]) => (
            <div key={platform}>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                <PlatformIcon platform={platform} size={16} /> {PLATFORM_SPECS[platform].name}
              </div>
              <div className="-mx-2">
                {conns.map((c) => (
                  <label key={c.id} className="inbound-tap flex min-h-9 cursor-pointer items-center gap-2.5 px-2 text-sm text-ink-700 hover:bg-ink-50">
                    <input type="checkbox" className="control-accent h-4 w-4" checked={value.connectionIds.includes(c.id)} onChange={() => toggleConnection(c.id)} />
                    {c.label || c.displayName || c.handle || `${PLATFORM_SPECS[platform].name} account`}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {grouped.length === 0 && <p className="text-sm text-ink-500">No image-capable accounts connected yet. Messages will be saved as drafts until one is connected.</p>}
        </div>
      </Field>
      <Field label="Publish mode" hint={value.publishMode === "queue" ? "Posts go through the scheduler queue instead of publishing immediately." : "Publishes to every target as soon as the message arrives."}>
        <SegmentedTabs<PublishMode>
          value={value.publishMode}
          onChange={(publishMode) => onChange({ publishMode })}
          items={[{ id: "all", label: "All at once" }, { id: "queue", label: "Queue" }]}
        />
      </Field>
      <label className="inbound-tap flex items-center gap-2.5 text-sm text-ink-700">
        <Toggle checked={value.confirmBeforePosting} onChange={(confirmBeforePosting) => onChange({ confirmBeforePosting })} label="Ask me to confirm before posting" size="sm" />
        Ask me to confirm before posting
      </label>
    </div>
  );
}

const WAITING_COPY: Record<InboundChannel, string> = {
  twilio: "Text this code from that phone to your Twilio number to finish linking.",
  telegram: "Send this code to the bot from that chat to finish linking.",
  test: "The test channel has no real device. Mark it as linked to continue, or post the code to /api/inbound/test.",
};

function BindingWaitingPanel({ channel, binding, onMarkLinked, marking }: {
  channel: InboundChannel;
  binding: InboundBinding;
  onMarkLinked: () => void;
  marking: boolean;
}) {
  const linked = binding.status === "verified";
  return (
    <div className="space-y-4">
      <div className={cn("border p-4 text-center", linked ? "border-green-200 bg-green-50" : "border-brand-300 bg-brand-50")}>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Verification code</p>
        <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.3em] text-ink-900" data-testid="binding-code" aria-label={binding.verificationCode ? `Verification code ${binding.verificationCode.split("").join(" ")}` : undefined}>
          {binding.verificationCode ?? "······"}
        </p>
        <p className="mt-2 text-sm text-ink-600">{linked ? `${binding.senderLabel || maskSenderId(binding.senderId)} is linked and can post.` : WAITING_COPY[channel]}</p>
      </div>
      <div className="flex items-center justify-center gap-2 text-sm" data-testid="binding-link-status" role="status" aria-live="polite">
        {linked ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-green-700"><Check className="h-4 w-4" /> Linked</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-ink-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Waiting for the code…</span>
        )}
      </div>
      {channel === "test" && !linked && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" className="inbound-tap" onClick={onMarkLinked} loading={marking} data-testid="mark-linked">Mark as linked</Button>
        </div>
      )}
    </div>
  );
}

function ListeningPanel({ binding, hint }: { binding: InboundBinding; hint: string }) {
  const [latest, setLatest] = useState<InboundMessage | null>(null);
  const { status } = useInboundStream({
    enabled: true,
    onEvent: (event) => { if (event.type === "message" && event.message.bindingId === binding.id) setLatest(event.message); },
  });
  return (
    <div className="space-y-4">
      <div className="notice-info">{hint} It shows up here as soon as it arrives.</div>
      <div className="flex items-center gap-2 text-xs text-ink-500" data-testid="listening-indicator" role="status" aria-live="polite">
        <span className={cn("h-1.5 w-1.5 rounded-full", status === "open" ? "bg-green-500" : "bg-ink-400 animate-pulse")} aria-hidden />
        {status === "open" ? "Listening…" : "Connecting…"}
      </div>
      {latest ? (
        <InboundMessagePreview message={latest} />
      ) : (
        <div className="flex flex-col items-center gap-2 border border-dashed border-ink-200 py-10 text-center text-sm text-ink-500">
          <Loader2 className="h-5 w-5 animate-spin text-ink-300" aria-hidden />
          Waiting for a message…
        </div>
      )}
    </div>
  );
}

function TestSendForm({ binding }: { binding: InboundBinding }) {
  const testSend = useInboundTestSend();
  const [caption, setCaption] = useState("A photo from the field");
  const [withImage, setWithImage] = useState(true);
  const [result, setResult] = useState<InboundMessage | null>(null);

  const submit = () => {
    const imageUrl = withImage ? generateTestImageDataUrl() ?? undefined : undefined;
    testSend.mutate(
      { senderId: binding.senderId, text: caption, imageUrl },
      { onSuccess: setResult, onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">Simulates {binding.senderLabel || binding.senderId} sending a photo with this caption. With confirmation on, the message waits for you in Recent messages.</p>
      <Field label="Caption" htmlFor="test-caption">
        <Input id="test-caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
      </Field>
      <label className="inbound-tap flex items-center gap-2.5 text-sm text-ink-700">
        <input type="checkbox" className="control-accent h-4 w-4" checked={withImage} onChange={(e) => setWithImage(e.target.checked)} />
        Include a generated image
      </label>
      <Button type="button" className="inbound-tap" icon={<Send className="h-4 w-4" />} onClick={submit} loading={testSend.isPending} data-testid="send-test-message">Send test message</Button>
      {result && (
        <div className="border-t border-ink-100 pt-4">
          <InboundMessagePreview message={result} />
        </div>
      )}
    </div>
  );
}

function StepDone({ channel, binding, onGoToMonitor }: { channel: InboundChannel; binding: InboundBinding; onGoToMonitor: () => void }) {
  return (
    <div className="space-y-3 py-4 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center bg-green-50 text-green-600"><Check className="h-5 w-5" /></div>
      <h3 className="text-base font-semibold text-ink-900">{CHANNEL_LABEL[channel]} is ready</h3>
      <p className="text-sm text-ink-500">
        {binding.senderLabel || maskSenderId(binding.senderId)} can post by sending a photo with a caption.
        {binding.confirmBeforePosting ? " Each post waits for a confirmation first." : ""}
      </p>
      <div className="flex justify-center">
        <Button type="button" variant="outline" className="inbound-tap" onClick={onGoToMonitor}>Go to the inbound monitor</Button>
      </div>
    </div>
  );
}

export interface InboundWizardProps {
  open: boolean;
  onClose: () => void;
  channels: InboundChannelConfig[];
  initialChannel?: InboundChannel | null;
  onFinished?: () => void;
}

const EMPTY_BINDING_FORM: BindingFormValues = { senderId: "", senderLabel: "", connectionIds: [], publishMode: "all", confirmBeforePosting: false };

/** Multi-step "Set up a channel" wizard: choose a channel, save its credentials, link a sender, prove it
 * end to end, then hand off to the inbound monitor. */
export function InboundWizard({ open, onClose, channels, initialChannel, onFinished }: InboundWizardProps) {
  const [step, setStep] = useState(initialChannel ? 2 : 1);
  const [channel, setChannel] = useState<InboundChannel | null>(initialChannel ?? null);
  const [savedConfig, setSavedConfig] = useState<InboundChannelConfig | null>(null);
  // Which channel was saved from this wizard session; GET /channels lists every channel, so "a config
  // exists" alone would let an unconfigured channel through.
  const [justSavedChannel, setJustSavedChannel] = useState<InboundChannel | null>(null);
  const [credentialsDirty, setCredentialsDirty] = useState(false);
  const [twilioForm, setTwilioForm] = useState<TwilioFormValues>({ accountSid: "", authToken: "", fromNumber: "" });
  const [telegramToken, setTelegramToken] = useState("");
  const [bindingForm, setBindingForm] = useState<BindingFormValues>(EMPTY_BINDING_FORM);
  const [binding, setBinding] = useState<InboundBinding | null>(null);
  const [liveBinding, setLiveBinding] = useState<InboundBinding | null>(null);

  const { data: connections = [] } = useConnections();
  const channelMutations = useInboundChannelMutations();
  const bindingMutations = useInboundBindingMutations();

  const displayBinding = liveBinding ?? binding;
  const pending = !!binding && displayBinding?.status === "pending";
  const bindingsQuery = useInboundBindings({ enabled: !!binding, refetchInterval: pending ? 3000 : false });
  useInboundStream({ enabled: pending, onEvent: () => bindingsQuery.refetch() });
  useEffect(() => {
    if (!binding) return;
    const found = bindingsQuery.data?.find((b) => b.id === binding.id);
    // The list endpoint never includes the code; keep the one from the create response so it stays on screen.
    if (found) setLiveBinding({ ...found, verificationCode: found.verificationCode ?? binding.verificationCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingsQuery.data, binding?.id]);

  // Reset the whole flow whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setStep(initialChannel ? 2 : 1);
    setChannel(initialChannel ?? null);
    setBindingForm(EMPTY_BINDING_FORM);
    setBinding(null);
    setLiveBinding(null);
    setJustSavedChannel(null);
    setCredentialsDirty(false);
    channelMutations.save.reset();
    bindingMutations.create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialChannel]);

  // Prefill credential forms from an existing config whenever the channel changes.
  useEffect(() => {
    if (!channel) return;
    const cfg = channels.find((c) => c.channel === channel) ?? null;
    setSavedConfig(cfg);
    setCredentialsDirty(false);
    channelMutations.save.reset();
    if (channel === "twilio") {
      setTwilioForm({
        accountSid: cfg?.settings.accountSid ?? "",
        authToken: cfg?.settings.authToken ?? "",
        fromNumber: cfg?.settings.fromNumber ?? "",
      });
    } else if (channel === "telegram") {
      setTelegramToken(cfg?.settings.botToken ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const configured = !!savedConfig && savedConfig.channel === channel && isChannelConfigured(savedConfig);
  const savedThisSession = justSavedChannel === channel && !!savedConfig && savedConfig.channel === channel;

  // The test channel has nothing to configure; save it automatically so it shows up as configured.
  useEffect(() => {
    if (channel === "test" && step === 2 && !configured && !savedThisSession && !channelMutations.save.isPending) {
      channelMutations.save.mutate({ channel: "test", input: { enabled: true, settings: {} } }, { onSuccess: (cfg) => { setSavedConfig(cfg); setJustSavedChannel("test"); } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, step, configured, savedThisSession]);

  const currentSettings = (): Record<string, string> => {
    if (channel === "twilio") return { accountSid: twilioForm.accountSid.trim(), authToken: twilioForm.authToken.trim(), fromNumber: twilioForm.fromNumber.trim() };
    if (channel === "telegram") return { botToken: telegramToken.trim() };
    return {};
  };

  const saveChannel = () => {
    if (!channel) return;
    channelMutations.save.mutate(
      { channel, input: { enabled: true, settings: currentSettings() } },
      {
        onSuccess: (cfg) => { setSavedConfig(cfg); setJustSavedChannel(channel); setCredentialsDirty(false); toast.success(`${CHANNEL_LABEL[channel]} saved`); },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const createBinding = () => {
    if (!channel) return;
    bindingMutations.create.mutate(
      {
        channel,
        senderId: bindingForm.senderId.trim(),
        senderLabel: bindingForm.senderLabel.trim() || undefined,
        connectionIds: bindingForm.connectionIds,
        publishMode: bindingForm.publishMode,
        confirmBeforePosting: bindingForm.confirmBeforePosting,
      },
      { onSuccess: (b) => { setBinding(b); setLiveBinding(b); }, onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  const markAsLinked = () => {
    if (!binding) return;
    bindingMutations.update.mutate(
      { id: binding.id, input: { status: "verified" } },
      { onSuccess: (b) => setLiveBinding({ ...b, verificationCode: b.verificationCode ?? binding.verificationCode }), onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  const webhookUrl = savedConfig?.webhookUrl || `${window.location.origin}/api/inbound/twilio`;

  // A saved Telegram token that Telegram itself rejected is a dead end; do not let the flow continue.
  const telegramRejected = channel === "telegram" && savedThisSession && !savedConfig?.webhookRegistered && !savedConfig?.settings.botUsername;
  // Next needs a complete configuration, not merely a save: an empty Twilio form must not lead into linking a sender.
  const saved = configured && !telegramRejected;
  const savedButIncomplete = savedThisSession && !configured && channel === "twilio";

  const canNext =
    step === 1 ? !!channel :
    step === 2 ? saved :
    step === 3 ? displayBinding?.status === "verified" :
    true;

  const goNext = () => setStep((s) => Math.min(5, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const close = () => { onClose(); };
  const finish = () => { onClose(); onFinished?.(); };

  const listeningHint =
    channel === "twilio" ? `Send a photo with a caption from the linked phone to ${savedConfig?.settings.fromNumber || "your Twilio number"}.` :
    channel === "telegram" ? `Send a photo with a caption to ${savedConfig?.settings.botUsername ? `@${savedConfig.settings.botUsername}` : "the bot"} from the linked chat.` :
    "Send a photo with a caption from the linked device.";

  const footer = (
    <div className="flex w-full items-center justify-between">
      <Button type="button" variant="ghost" className="inbound-tap" onClick={goBack} disabled={step === 1} data-testid="wizard-back">Back</Button>
      {step < 5 ? (
        <Button type="button" className="inbound-tap" onClick={goNext} disabled={!canNext} data-testid="wizard-next">Next</Button>
      ) : (
        <Button type="button" className="inbound-tap" onClick={finish} data-testid="wizard-done">Done</Button>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      data-testid="inbound-wizard"
      title="Set up a channel"
      description="Let people post to suprstar by texting or messaging a photo."
      className="inbound-wizard self-start mt-[3vh] sm:mt-[6vh]"
      footer={footer}
    >
      <StepIndicator step={step} />

      {step === 1 && <StepChannel value={channel} onChange={setChannel} />}

      {step === 2 && channel && (
        <div className="space-y-4">
          {channel === "twilio" && <TwilioCredentialsForm values={twilioForm} onChange={(patch) => { setTwilioForm((f) => ({ ...f, ...patch })); setCredentialsDirty(true); }} webhookUrl={webhookUrl} />}
          {channel === "telegram" && <TelegramCredentialsForm token={telegramToken} onChange={(v) => { setTelegramToken(v); setCredentialsDirty(true); }} savedConfig={savedConfig} justSaved={savedThisSession} />}
          {channel === "test" && (
            <div className="notice-info">
              Nothing to configure. The test channel simulates a chat so you can try the pipeline end to end.
              {channelMutations.save.isPending && <span className="ml-1 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Enabling…</span>}
            </div>
          )}
          {channelMutations.save.isError && <p className="notice-danger" role="alert">{errorMessage(channelMutations.save.error)}</p>}
          {savedButIncomplete && !credentialsDirty && (
            <p className="notice-warning" role="alert">
              Saved, but Twilio stays off until Account SID, auth token and from number are all filled in.
            </p>
          )}
          {channel !== "test" && (
            <div className="flex items-center gap-3">
              <Button type="button" size="sm" className="inbound-tap" onClick={saveChannel} loading={channelMutations.save.isPending} data-testid="wizard-save-channel">Save</Button>
              {saved && !credentialsDirty && <span className="inline-flex items-center gap-1 text-xs text-green-700" role="status"><Check className="h-3.5 w-3.5" /> Saved</span>}
              {credentialsDirty && <span className="text-xs text-ink-500">Unsaved changes</span>}
            </div>
          )}
        </div>
      )}

      {step === 3 && channel && (
        <div className="space-y-5">
          {!binding ? (
            <>
              <BindingForm channel={channel} value={bindingForm} onChange={(patch) => setBindingForm((f) => ({ ...f, ...patch }))} connections={connections} />
              {bindingMutations.create.isError && <p className="notice-danger" role="alert">{errorMessage(bindingMutations.create.error)}</p>}
              <Button type="button" className="inbound-tap" onClick={createBinding} disabled={!bindingForm.senderId.trim()} loading={bindingMutations.create.isPending} data-testid="wizard-create-binding">Link sender</Button>
            </>
          ) : (
            <BindingWaitingPanel channel={channel} binding={displayBinding!} onMarkLinked={markAsLinked} marking={bindingMutations.update.isPending} />
          )}
        </div>
      )}

      {step === 4 && channel && displayBinding && (
        channel === "test" ? <TestSendForm binding={displayBinding} /> : <ListeningPanel binding={displayBinding} hint={listeningHint} />
      )}

      {step === 5 && channel && displayBinding && <StepDone channel={channel} binding={displayBinding} onGoToMonitor={finish} />}
    </Modal>
  );
}
