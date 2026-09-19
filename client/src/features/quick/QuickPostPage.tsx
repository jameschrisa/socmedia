import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Camera, Check, ExternalLink, Loader2, Mic, Square } from "lucide-react";
import { PLATFORM_SPECS } from "@socmedia/shared";
import { useThemeMode } from "@/hooks/useThemeMode";
import { useQuickPostInfo } from "@/hooks/useQuickPost";
import { api, ApiError } from "@/lib/api";
import { OrgLogo, PlatformIcon, StatusBadge } from "@/components/ui";
import type { QuickPostResult } from "@socmedia/shared";

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong";
}

/** True when this browser exposes MediaRecorder + microphone access. */
function recordingSupported(): boolean {
  return typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;
}

/** True when this browser exposes the (possibly prefixed) Web Speech API. */
function speechSupported(): boolean {
  return typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

type Stage = "idle" | "uploading" | "done";

function Shell({ children }: { children: React.ReactNode }) {
  useThemeMode();
  return <div className="min-h-screen px-4 py-6 sm:py-10">{children}</div>;
}

export function QuickPostPage() {
  const { token } = useParams<{ token: string }>();
  const info = useQuickPostInfo(token);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [transcript, setTranscript] = useState("");
  const [memoBlob, setMemoBlob] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [polish, setPolish] = useState(true);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<QuickPostResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const canRecord = recordingSupported();
  const canTranscribe = speechSupported();

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoFile(file);
    setPhotoUrl(URL.createObjectURL(file));
    setValidationError(null);
  };

  const startRecording = async () => {
    if (!canRecord) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        setMemoBlob(new Blob(chunks, { type: "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);

      if (canTranscribe) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event: any) => {
          let text = "";
          for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
          setTranscript(text);
        };
        recognition.start();
        recognitionRef.current = recognition;
      }
    } catch {
      setSubmitError("Couldn't access the microphone. Check your browser permissions.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recognitionRef.current?.stop?.();
    setRecording(false);
  };

  const reset = () => {
    setPhotoFile(null);
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setCaption("");
    setTranscript("");
    setMemoBlob(null);
    setStage("idle");
    setResult(null);
    setValidationError(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async () => {
    if (!token) return;
    if (!photoFile) { setValidationError("Add a photo before posting."); return; }
    if (!canTranscribe && !caption.trim() && !transcript.trim()) {
      setValidationError("Voice transcription isn't available in this browser. Type a caption before posting.");
      return;
    }
    setValidationError(null);
    setSubmitError(null);
    const form = new FormData();
    form.append("image", photoFile);
    if (memoBlob) form.append("memo", memoBlob, "memo.webm");
    if (caption.trim()) form.append("caption", caption.trim());
    if (transcript.trim()) form.append("transcript", transcript.trim());
    form.append("polish", String(polish && info.data?.aiAvailable));
    setStage("uploading");
    try {
      const res = await api.quick.post(token, form);
      setResult(res);
      setStage("done");
    } catch (e) {
      setStage("idle");
      if (e instanceof ApiError && e.status === 429) setSubmitError("Too many posts from this link right now. Try again in a minute.");
      else if (e instanceof ApiError && e.status === 404) setSubmitError("This link is no longer valid.");
      else setSubmitError(errorMessage(e));
    }
  };

  if (info.isLoading) {
    return (
      <Shell>
        <div className="mx-auto flex max-w-sm flex-col items-center justify-center gap-3 py-24 text-ink-500">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          <p className="text-sm">Opening your quick post link…</p>
        </div>
      </Shell>
    );
  }

  if (info.isError || !info.data) {
    const notFound = info.error instanceof ApiError && info.error.status === 404;
    return (
      <Shell>
        <div className="mx-auto max-w-sm py-24">
          <div className="card p-6 text-center">
            <h1 className="font-display text-xl text-ink-900">{notFound ? "Link no longer valid" : "Couldn't open this link"}</h1>
            <p className="notice-danger mt-3" role="alert">
              {notFound ? "This quick post link was revoked or never existed." : errorMessage(info.error)}
            </p>
            {notFound ? (
              <p className="mt-3 text-sm text-ink-500">Ask whoever set up the link to create a new one from Settings and share it again.</p>
            ) : (
              <button type="button" onClick={() => info.refetch()} className="focus-ring mt-4 h-11 w-full border border-ink-200 text-sm font-medium text-ink-700">
                Try again
              </button>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  const { data } = info;

  if (stage === "done" && result) {
    return (
      <Shell>
        <div className="mx-auto max-w-sm space-y-5">
          <div className="flex items-center gap-2">
            <OrgLogo org={{ name: data.orgName, brandColor: data.brandColor, logoUrl: data.orgLogoUrl }} size={32} />
            <span className="font-display text-lg text-ink-900">{data.orgName}</span>
          </div>
          <div className="card p-5 space-y-4" data-testid="quick-post-result">
            <div className="flex items-center gap-2 text-green-600">
              <Check className="h-5 w-5" /> <h2 className="text-base font-semibold text-ink-900">Posted</h2>
            </div>
            {result.status === "needs_caption" && (
              <p className="notice-warning">Saved as a draft without a caption. Add one later from the calendar when you're back at a desk.</p>
            )}
            <ul className="space-y-2">
              {result.links.map((link) => (
                <li key={link.connectionId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-ink-100 pb-2 last:border-0 last:pb-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <PlatformIcon platform={link.platform} size={28} />
                    <span className="min-w-0 truncate text-sm text-ink-800">{link.label || PLATFORM_SPECS[link.platform].name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <StatusBadge status={link.status} />
                    {link.url ? (
                      <a href={link.url} target="_blank" rel="noreferrer" className="link inline-flex min-h-11 items-center gap-1 px-2 text-sm">
                        Open <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    ) : null}
                  </span>
                  {!link.url && link.error && <span className="basis-full text-xs text-red-600">{link.error}</span>}
                </li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={reset} className="focus-ring h-12 w-full border border-ink-200 text-sm font-semibold text-ink-800">
            Post another
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-sm space-y-5">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <OrgLogo org={{ name: data.orgName, brandColor: data.brandColor, logoUrl: data.orgLogoUrl }} size={32} />
            <div>
              <p className="font-display text-lg leading-tight text-ink-900">{data.orgName}</p>
              <p className="text-xs text-ink-500">{data.label}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.targets.map((t) => (
              <span key={t.connectionId} className="chip chip-inactive">
                <PlatformIcon platform={t.platform} size={16} /> {t.label || t.handle || PLATFORM_SPECS[t.platform].name}
              </span>
            ))}
          </div>
        </header>

        <label className="block">
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={onPhotoChange} className="sr-only" data-testid="photo-input" disabled={stage === "uploading"} />
          <div className={`flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed text-center transition-colors focus-within:ring-2 focus-within:ring-brand-300 ${validationError && !photoFile ? "border-red-500 bg-red-50" : "border-ink-300 bg-glass-veil"}`}>
            {photoUrl ? (
              <img src={photoUrl} alt="Selected photo preview" className="h-[220px] w-full object-cover" />
            ) : (
              <>
                <Camera className="h-8 w-8 text-ink-400" />
                <span className="text-sm font-semibold text-ink-700">Take a photo</span>
                <span className="text-xs text-ink-500">Tap to open your camera</span>
              </>
            )}
          </div>
        </label>
        {photoUrl && (
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={stage === "uploading"} className="focus-ring h-11 w-full border border-ink-200 text-sm font-medium text-ink-700 disabled:opacity-50">
            Retake photo
          </button>
        )}

        <div className="space-y-1.5">
          <label htmlFor="quick-caption" className="label">Caption {!canTranscribe && <span className="text-red-500">*</span>}</label>
          <textarea
            id="quick-caption"
            className="input min-h-[96px] text-base"
            placeholder="What's happening?"
            value={caption}
            disabled={stage === "uploading"}
            onChange={(e) => setCaption(e.target.value)}
          />
        </div>

        {canRecord ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={stage === "uploading"}
              aria-pressed={recording}
              className={`focus-ring flex h-11 w-full items-center justify-center gap-2 text-sm font-semibold disabled:opacity-50 ${recording ? "bg-red-500 text-white" : "border border-ink-200 text-ink-700"}`}
              data-testid="record-toggle"
            >
              {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {recording ? "Stop recording" : "Record a voice memo"}
            </button>
            {!canTranscribe && (
              <p className="notice-info">Live transcription isn't available in this browser. Your memo still uploads, so please type a caption above.</p>
            )}
            {(recording || transcript) && canTranscribe && (
              <div className="space-y-1">
                <label htmlFor="quick-transcript" className="label">Transcript (editable)</label>
                <textarea id="quick-transcript" className="input min-h-[64px]" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
              </div>
            )}
          </div>
        ) : (
          <p className="notice-info">Voice memos aren't supported in this browser. Type a caption instead, or open the link in Safari or Chrome.</p>
        )}

        <label className={`flex min-h-11 items-center gap-3 text-sm text-ink-700 ${data.aiAvailable ? "cursor-pointer" : "cursor-not-allowed"}`}>
          <input
            type="checkbox"
            className="control-accent h-5 w-5 shrink-0"
            checked={polish && !!data.aiAvailable}
            disabled={!data.aiAvailable || stage === "uploading"}
            onChange={(e) => setPolish(e.target.checked)}
          />
          <span>
            Polish with AI
            {!data.aiAvailable && <span className="ml-1.5 text-xs text-ink-500">(unavailable right now)</span>}
          </span>
        </label>

        {validationError && <p className="notice-danger" role="alert">{validationError}</p>}
        {submitError && <p className="notice-danger" role="alert">{submitError}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={stage === "uploading"}
          aria-busy={stage === "uploading"}
          className="focus-ring flex h-12 w-full items-center justify-center gap-2 bg-brand-500 text-[color:var(--c-on-brand)] text-base font-semibold hover:bg-brand-600 disabled:opacity-60"
        >
          {stage === "uploading" ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Posting…</> : "Post now"}
        </button>
      </div>
    </Shell>
  );
}
