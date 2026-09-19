import { useState } from "react";
import { Check, Film } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Skeleton";
import { useMedia } from "@/hooks/useMedia";
import { cn } from "@/lib/utils";

export function MediaPicker({
  open,
  onClose,
  onConfirm,
  initialSelected = [],
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
  initialSelected?: string[];
}) {
  const { data: media, isLoading } = useMedia();
  const [selected, setSelected] = useState<string[]>(initialSelected);

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add from library"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => { onConfirm(selected); onClose(); }} disabled={selected.length === 0}>
            Add {selected.length > 0 ? `(${selected.length})` : ""}
          </Button>
        </>
      }
    >
      {isLoading ? (
        <p className="py-8 text-center text-sm text-ink-500">Loading media…</p>
      ) : !media || media.length === 0 ? (
        <EmptyState title="No media yet" description="Upload images or video from Studio first." />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {media.map((asset) => {
            const active = selected.includes(asset.id);
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => toggle(asset.id)}
                aria-pressed={active}
                aria-label={asset.filename}
                className={cn("relative aspect-square rounded-lg overflow-hidden border-2", active ? "border-brand-500" : "border-transparent")}
              >
                {asset.kind === "image" ? (
                  <img src={asset.thumbnailUrl ?? asset.url} alt={asset.filename} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-ink-100 text-ink-400"><Film className="h-6 w-6" /></div>
                )}
                {active && (
                  <span className="absolute right-1 top-1 rounded-full bg-brand-500 p-0.5 text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
