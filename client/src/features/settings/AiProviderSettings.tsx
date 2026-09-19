import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Eye, EyeOff, KeyRound, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { AI_MODEL_SUGGESTIONS, type AiProvider, type AiSettings, type AiProviderTestResult } from "@socmedia/shared";
import { Badge, Button, Card, Field, Input, SegmentedTabs, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type KeyedProvider = Exclude<AiProvider, "mock">;

interface FormState {
  provider: AiProvider;
  anthropic: { apiKey: string; model: string };
  moonshot: { apiKey: string; model: string; baseUrl: string };
}

const PROVIDER_META: Record<KeyedProvider, { name: string; vendor: string; keyPlaceholder: string; docsUrl: string; blurb: string }> = {
  anthropic: {
    name: "Claude",
    vendor: "Anthropic",
    keyPlaceholder: "sk-ant-…",
    docsUrl: "https://console.anthropic.com/settings/keys",
    blurb: "Native structured outputs. Best quality for captions and ideas.",
  },
  moonshot: {
    name: "Kimi",
    vendor: "Moonshot AI",
    keyPlaceholder: "sk-…",
    docsUrl: "https://platform.moonshot.ai/console/api-keys",
    blurb: "OpenAI-compatible endpoint (api.moonshot.ai/v1) using JSON mode.",
  },
};

function toForm(s: AiSettings): FormState {
  return {
    provider: s.provider,
    anthropic: { apiKey: s.anthropic.apiKey, model: s.anthropic.model },
    moonshot: { apiKey: s.moonshot.apiKey, model: s.moonshot.model, baseUrl: s.moonshot.baseUrl ?? "https://api.moonshot.ai/v1" },
  };
}

export function AiProviderSettings() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: qk.aiSettings, queryFn: api.settings.getAi });
  const [form, setForm] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [testResults, setTestResults] = useState<Partial<Record<KeyedProvider, AiProviderTestResult>>>({});
  const [fetchedModels, setFetchedModels] = useState<Partial<Record<KeyedProvider, string[]>>>({});

  useEffect(() => {
    if (settings.data && !dirty) setForm(toForm(settings.data));
  }, [settings.data, dirty]);

  const save = useMutation({
    mutationFn: (input: FormState) => api.settings.updateAi(input),
    onSuccess: (data) => {
      qc.setQueryData(qk.aiSettings, data);
      qc.invalidateQueries({ queryKey: qk.health });
      setDirty(false);
      setForm(toForm(data));
      toast.success("AI settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: async (provider: KeyedProvider) => {
      if (dirty && form) {
        const saved = await api.settings.updateAi(form);
        qc.setQueryData(qk.aiSettings, saved);
        setDirty(false);
        setForm(toForm(saved));
      }
      return api.settings.testAi(provider);
    },
    onSuccess: (result) => {
      setTestResults((r) => ({ ...r, [result.provider]: result }));
      (result.ok ? toast.success : toast.error)(result.message);
      qc.invalidateQueries({ queryKey: qk.health });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const models = useMutation({
    mutationFn: (provider: KeyedProvider) => api.settings.aiModels(provider),
    onSuccess: (res) => {
      setFetchedModels((m) => ({ ...m, [res.provider as KeyedProvider]: res.models }));
      toast.success(`${res.models.length} models available`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!form || settings.isLoading) {
    return <Card className="p-5"><Skeleton className="h-6 w-40" /><Skeleton className="mt-4 h-24" /></Card>;
  }

  const update = (patch: Partial<FormState>) => { setForm((f) => (f ? { ...f, ...patch } : f)); setDirty(true); };
  const updateProvider = <P extends KeyedProvider>(p: P, patch: Partial<FormState[P]>) => { setForm((f) => (f ? { ...f, [p]: { ...f[p], ...patch } } : f)); setDirty(true); };

  return (
    <Card className="p-5 space-y-5" data-testid="ai-provider-settings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900"><Sparkles className="h-4 w-4 text-brand-500" /> AI provider</h3>
          <p className="mt-1 text-sm text-ink-500">Choose which model writes captions and ideas. Keys are encrypted at rest and never returned in full.</p>
        </div>
        <SegmentedTabs<AiProvider>
          size="md"
          value={form.provider}
          onChange={(provider) => update({ provider })}
          items={[
            { id: "anthropic", label: "Claude (Anthropic)" },
            { id: "moonshot", label: "Kimi (Moonshot)" },
            { id: "mock", label: "Offline mock" },
          ]}
        />
      </div>

      {form.provider === "mock" && (
        <p className="border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-600">
          Offline mock generates template captions locally. Pick a provider above and add a key to use a real model.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(["anthropic", "moonshot"] as KeyedProvider[]).map((p) => (
          <ProviderCard
            key={p}
            provider={p}
            active={form.provider === p}
            values={form[p]}
            fromEnv={p === "anthropic" && !!settings.data?.anthropicFromEnv}
            fetchedModels={fetchedModels[p]}
            testResult={testResults[p]}
            testing={test.isPending && test.variables === p}
            fetching={models.isPending && models.variables === p}
            onChange={(patch) => updateProvider(p, patch as Partial<FormState[typeof p]>)}
            onUse={() => update({ provider: p })}
            onTest={() => test.mutate(p)}
            onFetchModels={() => models.mutate(p)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-ink-100 pt-4">
        <p className="text-xs text-ink-500">
          {settings.data?.updatedAt ? `Last saved ${new Date(settings.data.updatedAt).toLocaleString()}` : "Not saved yet"}
          {dirty && <span className="ml-2 text-amber-600">· Unsaved changes</span>}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => { if (settings.data) setForm(toForm(settings.data)); setDirty(false); }}>Discard</Button>
          <Button onClick={() => form && save.mutate(form)} loading={save.isPending} disabled={!dirty} data-testid="ai-settings-save">Save settings</Button>
        </div>
      </div>
    </Card>
  );
}

function ProviderCard({ provider, active, values, fromEnv, fetchedModels, testResult, testing, fetching, onChange, onUse, onTest, onFetchModels }: {
  provider: KeyedProvider;
  active: boolean;
  values: { apiKey: string; model: string; baseUrl?: string };
  fromEnv: boolean;
  fetchedModels?: string[];
  testResult?: AiProviderTestResult;
  testing: boolean;
  fetching: boolean;
  onChange: (patch: Partial<{ apiKey: string; model: string; baseUrl: string }>) => void;
  onUse: () => void;
  onTest: () => void;
  onFetchModels: () => void;
}) {
  const meta = PROVIDER_META[provider];
  const [reveal, setReveal] = useState(false);
  const suggestions = AI_MODEL_SUGGESTIONS[provider];
  const options = [...new Set([...suggestions.map((s) => s.id), ...(fetchedModels ?? [])])];
  const isCustom = !options.includes(values.model);
  const hasKey = !!values.apiKey;

  return (
    <div className={cn("border p-4 space-y-3 transition-colors", active ? "border-brand-400 bg-brand-50" : "border-ink-200")} data-testid={`provider-${provider}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">{meta.name}</h4>
            <span className="text-xs text-ink-500">{meta.vendor}</span>
            {active && <Badge tone="brand">Active</Badge>}
            {fromEnv && !values.apiKey.startsWith("••••") && <Badge tone="info">from env</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-ink-500">{meta.blurb}</p>
        </div>
        {!active && <Button size="xs" variant="outline" onClick={onUse}>Use</Button>}
      </div>

      <Field label="API key" htmlFor={`${provider}-key`} hint={hasKey && values.apiKey.startsWith("••••") ? "Saved. Paste a new key to replace it, or clear to remove." : undefined}>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
          <Input
            id={`${provider}-key`}
            type={reveal ? "text" : "password"}
            className="pl-8 pr-9 font-mono"
            placeholder={meta.keyPlaceholder}
            value={values.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            autoComplete="off"
          />
          <button type="button" aria-label={reveal ? "Hide key" : "Show key"} onClick={() => setReveal((r) => !r)} className="absolute right-2 top-2 text-ink-400 hover:text-ink-700">
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>

      <Field label="Model" htmlFor={`${provider}-model`}>
        <div className="flex gap-2">
          <Select id={`${provider}-model`} value={isCustom ? "__custom" : values.model} onChange={(e) => { if (e.target.value !== "__custom") onChange({ model: e.target.value }); else onChange({ model: "" }); }}>
            {suggestions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            {(fetchedModels ?? []).filter((id) => !suggestions.some((s) => s.id === id)).map((id) => <option key={id} value={id}>{id}</option>)}
            <option value="__custom">Custom model id…</option>
          </Select>
          <Button variant="outline" size="md" icon={<RefreshCw className={cn("h-4 w-4", fetching && "animate-spin")} />} onClick={onFetchModels} disabled={!hasKey || fetching} title="Fetch the models this key can access">Fetch</Button>
        </div>
        {isCustom && <Input className="mt-2 font-mono" placeholder="model-id" value={values.model} onChange={(e) => onChange({ model: e.target.value })} aria-label={`${meta.name} custom model id`} />}
      </Field>

      {provider === "moonshot" && (
        <Field label="Base URL" htmlFor="moonshot-base">
          <Input id="moonshot-base" className="font-mono" value={values.baseUrl ?? ""} onChange={(e) => onChange({ baseUrl: e.target.value })} placeholder="https://api.moonshot.ai/v1" />
        </Field>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <a className="link text-xs" href={meta.docsUrl} target="_blank" rel="noreferrer">Get an API key</a>
        <Button size="sm" variant="secondary" onClick={onTest} loading={testing} disabled={!hasKey}>Test connection</Button>
      </div>
      {testResult && (
        <div className={cn("flex items-start gap-2 border px-3 py-2 text-xs", testResult.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800")} role="status">
          {testResult.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{testResult.message} {testResult.latencyMs ? <span className="opacity-70">· {testResult.latencyMs}ms</span> : null}</span>
        </div>
      )}
    </div>
  );
}
