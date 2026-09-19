import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { addDays, addMonths, addWeeks, endOfDay, format, startOfDay, startOfWeek, subMonths, subWeeks } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PLATFORMS, type Platform, type Post } from "@socmedia/shared";
import { useMedia, usePostMutations, usePosts } from "@/hooks";
import { useAppStore } from "@/store/appStore";
import { buildMonthGrid } from "./calendarUtils";
import { CalendarToolbar } from "./CalendarToolbar";
import { CreativeSidebar } from "./CreativeSidebar";
import { handleDrop } from "./dragDrop";
import { MonthGrid } from "./MonthGrid";
import { PostPeek } from "./PostPeek";
import { SchedulePopover, type SchedulePopoverState } from "./SchedulePopover";
import { WeekGrid } from "./WeekGrid";

const DRAFT_STATUSES = ["draft", "needs_approval", "approved"];
const DEFAULT_NEW_POST_MINUTES = 10 * 60;

export function CalendarPage() {
  const [monthDate, setMonthDate] = useState(() => startOfDay(new Date()));
  const view = useAppStore((s) => s.calendarView);
  const setView = useAppStore((s) => s.setCalendarView);
  const openComposer = useAppStore((s) => s.openComposer);

  const [activePlatforms, setActivePlatforms] = useState<Set<Platform>>(() => new Set(PLATFORMS));
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [peek, setPeek] = useState<{ post: Post; position: { x: number; y: number } } | null>(null);
  const [scheduleState, setScheduleState] = useState<SchedulePopoverState | null>(null);

  const weeks = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
  const weekStart = useMemo(() => startOfWeek(monthDate), [monthDate]);

  const rangeStart = view === "month" ? weeks[0]![0]! : weekStart;
  const rangeEnd = view === "month" ? weeks[weeks.length - 1]![6]! : addDays(weekStart, 6);
  const from = startOfDay(rangeStart).toISOString();
  const to = endOfDay(rangeEnd).toISOString();

  const rangeQuery = usePosts({ from, to });
  const draftsQuery = usePosts({ includeUnscheduled: true, status: DRAFT_STATUSES });
  const mediaQuery = useMedia();
  const { update } = usePostMutations();

  const drafts = useMemo(() => (draftsQuery.data ?? []).filter((p) => !p.scheduledAt), [draftsQuery.data]);

  // Combined lookup used by the drag/drop resolver so it can find posts
  // regardless of whether they came from the grid range or the sidebar drafts.
  const allKnownPosts = useMemo(() => {
    const map = new Map<string, Post>();
    for (const p of rangeQuery.data ?? []) map.set(p.id, p);
    for (const p of draftsQuery.data ?? []) map.set(p.id, p);
    return [...map.values()];
  }, [rangeQuery.data, draftsQuery.data]);

  const visiblePosts = useMemo(
    () => (rangeQuery.data ?? []).filter((p) => p.targets.length === 0 || p.targets.some((t) => activePlatforms.has(t.platform))),
    [rangeQuery.data, activePlatforms],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const togglePlatform = (p: Platform) => {
    setActivePlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const goPrev = () => setMonthDate((d) => (view === "month" ? subMonths(d, 1) : subWeeks(d, 1)));
  const goNext = () => setMonthDate((d) => (view === "month" ? addMonths(d, 1) : addWeeks(d, 1)));
  const goToday = () => setMonthDate(startOfDay(new Date()));

  const title = view === "month" ? format(monthDate, "MMMM yyyy") : `Week of ${format(weekStart, "MMM d, yyyy")}`;

  const openPeek = (post: Post, e: React.MouseEvent<HTMLButtonElement>) => {
    setPeek({ post, position: { x: e.clientX, y: e.clientY } });
  };

  const openNewPostFor = (date: Date, hour?: number) => {
    setScheduleState({ date, minutes: hour != null ? hour * 60 : DEFAULT_NEW_POST_MINUTES, target: { kind: "new" } });
  };

  const handleNewPostClick = () => {
    const scheduledAt = new Date();
    scheduledAt.setHours(10, 0, 0, 0);
    openComposer(null, { scheduledAt: scheduledAt.toISOString() });
  };

  const onDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const overId = e.over ? String(e.over.id) : null;
    const action = handleDrop({ activeId: String(e.active.id), overId, posts: allKnownPosts, media: mediaQuery.data ?? [] });

    switch (action.type) {
      case "open-schedule-for-media":
        setScheduleState({
          date: action.date,
          minutes: action.hour != null ? action.hour * 60 : DEFAULT_NEW_POST_MINUTES,
          target: { kind: "media", mediaId: action.mediaId },
        });
        break;
      case "open-schedule-for-draft":
        setScheduleState({
          date: action.date,
          minutes: action.hour != null ? action.hour * 60 : DEFAULT_NEW_POST_MINUTES,
          target: { kind: "draft", post: action.post },
        });
        break;
      case "move-post":
        update.mutate(
          { id: action.post.id, input: { scheduledAt: action.scheduledAt } },
          { onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to move post") },
        );
        toast.success("Post rescheduled");
        break;
      case "blocked":
        toast.info(action.reason);
        break;
      default:
        break;
    }
  };

  const draggingMedia = activeDragId?.startsWith("media-") ? mediaQuery.data?.find((m) => `media-${m.id}` === activeDragId) : undefined;
  const draggingPost = activeDragId?.startsWith("post-") ? allKnownPosts.find((p) => `post-${p.id}` === activeDragId) : undefined;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveDragId(null)}>
      <div className="flex h-full flex-col gap-4">
        <CalendarToolbar
          title={title}
          view={view}
          onViewChange={setView}
          onPrev={goPrev}
          onNext={goNext}
          onToday={goToday}
          activePlatforms={activePlatforms}
          onTogglePlatform={togglePlatform}
          onSetAllPlatforms={(all) => setActivePlatforms(new Set(all ? PLATFORMS : []))}
          onNewPost={handleNewPostClick}
        />

        <div className="flex flex-1 gap-4 overflow-hidden">
          <CreativeSidebar media={mediaQuery.data ?? []} mediaLoading={mediaQuery.isLoading} drafts={drafts} draftsLoading={draftsQuery.isLoading} />

          {view === "month" ? (
            <MonthGrid monthDate={monthDate} posts={visiblePosts} onSelectPost={openPeek} onEmptyDayClick={(date) => openNewPostFor(date)} />
          ) : (
            <WeekGrid weekStart={weekStart} posts={visiblePosts} onSelectPost={openPeek} onEmptySlotClick={(date, hour) => openNewPostFor(date, hour)} />
          )}
        </div>
      </div>

      <DragOverlay>
        {draggingMedia && (
          <div aria-hidden className="h-16 w-16 overflow-hidden rounded-lg border border-ink-200 bg-glass shadow-pop">
            <img src={draggingMedia.thumbnailUrl ?? draggingMedia.url} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        {draggingPost && (
          <div aria-hidden className="rounded-md border-l-4 border-brand-500 bg-glass px-2 py-1 text-xs shadow-pop">
            {draggingPost.title || draggingPost.caption || "Post"}
          </div>
        )}
      </DragOverlay>

      {peek && <PostPeek post={peek.post} position={peek.position} onClose={() => setPeek(null)} />}
      <SchedulePopover state={scheduleState} onClose={() => setScheduleState(null)} />
    </DndContext>
  );
}
