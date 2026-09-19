import { AnimatePresence, motion } from "framer-motion";
import { Portal } from "@/components/ui/Portal";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import type { Post } from "@socmedia/shared";
import { Button, PlatformIcon, StatusBadge } from "@/components/ui";
import { usePostMutations } from "@/hooks";
import { useAppStore } from "@/store/appStore";

export interface PostPeekProps {
  post: Post;
  position: { x: number; y: number };
  onClose: () => void;
}

const PANEL_W = 320;
const PANEL_H = 320;

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** Small anchored popover showing post details and quick actions. */
export function PostPeek({ post, position, onClose }: PostPeekProps) {
  const { approve, publish, duplicate, remove } = usePostMutations();
  const openComposer = useAppStore((s) => s.openComposer);

  const canPublish = post.status !== "published" && post.status !== "partially_published" && post.status !== "publishing";

  const handleApprove = async () => {
    try {
      await approve.mutateAsync(post.id);
      toast.success("Post approved");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Failed to approve post"));
    }
  };

  const handlePublish = async () => {
    if (typeof window !== "undefined" && !window.confirm(`Publish "${post.title || "this post"}" now?`)) return;
    try {
      await publish.mutateAsync(post.id);
      toast.success("Post published");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Failed to publish post"));
    }
  };

  const handleDuplicate = async () => {
    try {
      await duplicate.mutateAsync(post.id);
      toast.success("Duplicated as a new draft");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Failed to duplicate post"));
    }
  };

  const handleDelete = async () => {
    if (typeof window !== "undefined" && !window.confirm("Delete this post? This cannot be undone.")) return;
    try {
      await remove.mutateAsync(post.id);
      toast.success("Post deleted");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Failed to delete post"));
    }
  };

  const top = typeof window !== "undefined" ? Math.min(position.y, Math.max(8, window.innerHeight - PANEL_H)) : position.y;
  const left = typeof window !== "undefined" ? Math.min(position.x, Math.max(8, window.innerWidth - PANEL_W)) : position.x;

  return (
    <Portal>
    <AnimatePresence>
      <div key="backdrop" className="fixed inset-0 z-[90]" onClick={onClose} aria-hidden />
      <motion.div
        key="panel"
        role="dialog"
        aria-label={`Post details: ${post.title || "Untitled post"}`}
        initial={{ opacity: 0, scale: 0.96, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className="card glass-menu fixed z-[100] p-4"
        style={{ top, left, width: PANEL_W }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink-900">{post.title || "Untitled post"}</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              {post.scheduledAt ? format(parseISO(post.scheduledAt), "EEE, MMM d · h:mm a") : "Not scheduled"}
            </p>
          </div>
          <StatusBadge status={post.status} />
        </div>

        {post.caption && <p className="mt-2 line-clamp-3 text-xs text-ink-600">{post.caption}</p>}

        <div className="mt-2 flex items-center gap-1">
          {post.targets.map((t) => (
            <PlatformIcon key={t.platform} platform={t.platform} size={22} />
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={() => { openComposer(post.id); onClose(); }} aria-label="Edit post">
            Edit
          </Button>
          {post.status === "needs_approval" && (
            <Button size="xs" variant="outline" loading={approve.isPending} onClick={handleApprove} aria-label="Approve post">
              Approve
            </Button>
          )}
          {canPublish && (
            <Button size="xs" variant="outline" loading={publish.isPending} onClick={handlePublish} aria-label="Publish post now">
              Publish now
            </Button>
          )}
          <Button size="xs" variant="outline" loading={duplicate.isPending} onClick={handleDuplicate} aria-label="Duplicate post">
            Duplicate
          </Button>
          <Button size="xs" variant="danger" loading={remove.isPending} onClick={handleDelete} aria-label="Delete post">
            Delete
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
    </Portal>
  );
}
