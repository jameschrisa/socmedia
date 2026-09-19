import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Platform, Post, ValidationIssue } from "@socmedia/shared";
import { Button, formatMinutes, Modal, TimeScroller } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { usePostMutations } from "@/hooks";
import { useAppStore } from "@/store/appStore";
import { combineDayAndMinutes } from "./calendarUtils";

export type ScheduleTarget =
  | { kind: "media"; mediaId: string; mediaLabel?: string }
  | { kind: "draft"; post: Post }
  | { kind: "new" };

export interface SchedulePopoverState {
  date: Date;
  minutes: number;
  target: ScheduleTarget;
}

export interface SchedulePopoverProps {
  state: SchedulePopoverState | null;
  onClose: () => void;
}

const DEFAULT_MINUTES = 10 * 60;

/**
 * Shared "schedule this" modal used for: dropping media on the calendar,
 * dropping a draft on the calendar, and clicking an empty day/slot to start
 * a brand new post.
 */
export function SchedulePopover({ state, onClose }: SchedulePopoverProps) {
  const open = !!state;
  const [minutes, setMinutes] = useState(state?.minutes ?? DEFAULT_MINUTES);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const openComposer = useAppStore((s) => s.openComposer);
  const { schedule } = usePostMutations();

  useEffect(() => {
    if (state) {
      setMinutes(state.minutes);
      setIssues(null);
    }
  }, [state]);

  const platform: Platform | undefined = state?.target.kind === "draft" ? state.target.post.targets[0]?.platform : undefined;

  const bestTimes = useQuery({
    queryKey: ["ai", "bestTimes", platform],
    queryFn: () => api.ai.bestTimes(platform!),
    enabled: !!platform && open,
  });

  const weekday = state?.date.getDay() ?? 0;
  const suggestions = useMemo(() => {
    const slots = bestTimes.data?.slots ?? [];
    const sameDay = slots.filter((s) => s.weekday === weekday);
    const pool = sameDay.length ? sameDay : slots;
    return [...pool].sort((a, b) => b.score - a.score).slice(0, 3);
  }, [bestTimes.data, weekday]);

  if (!state) return null;
  const { date, target } = state;

  const friendly = format(date, "EEE, MMM d");
  const title =
    target.kind === "media" ? `Schedule creative for ${friendly}` : target.kind === "draft" ? `Schedule post for ${friendly}` : `New post for ${friendly}`;
  const buttonLabel = target.kind === "draft" ? "Schedule" : "Create post";

  const handleConfirm = async () => {
    const iso = combineDayAndMinutes(date, minutes);

    if (target.kind === "media") {
      openComposer(null, { scheduledAt: iso, mediaIds: [target.mediaId] });
      onClose();
      return;
    }

    if (target.kind === "new") {
      openComposer(null, { scheduledAt: iso });
      onClose();
      return;
    }

    try {
      await schedule.mutateAsync({ id: target.post.id, scheduledAt: iso });
      toast.success("Post scheduled");
      onClose();
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) {
        setIssues(e.details as ValidationIssue[]);
      } else {
        toast.error(e instanceof Error ? e.message : "Failed to schedule post");
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={schedule.isPending} onClick={handleConfirm}>
            {buttonLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <TimeScroller value={minutes} onChange={setMinutes} minuteStep={5} />
        <p className="text-sm font-medium text-ink-700" aria-live="polite">
          {formatMinutes(minutes)}
        </p>

        {platform && (
          <div className="w-full">
            <p className="label mb-1.5">Best time to post</p>
            {bestTimes.isLoading ? (
              <p className="text-xs text-ink-400">Loading suggestions…</p>
            ) : suggestions.length === 0 ? (
              <p className="text-xs text-ink-400">No suggestions yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={`${s.weekday}-${s.hour}`}
                    type="button"
                    onClick={() => setMinutes(s.hour * 60)}
                    className="rounded-full border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-600 hover:border-brand-300 hover:text-brand-700"
                  >
                    {formatMinutes(s.hour * 60)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {issues && issues.length > 0 && (
          <div className="w-full rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <p className="mb-1 font-semibold">This post can&apos;t be scheduled yet:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {issues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
            <Button
              size="xs"
              variant="outline"
              className="mt-2"
              onClick={() => {
                if (target.kind === "draft") openComposer(target.post.id);
                onClose();
              }}
            >
              Open in composer
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
