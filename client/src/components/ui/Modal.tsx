import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Portal } from "./Portal";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
  "data-testid"?: string;
}

const sizes = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl", full: "max-w-[96vw]" };

export function Modal({ open, onClose, title, description, children, footer, size = "md", className, "data-testid": testId }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <Portal>
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid={testId}>
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={cn("relative w-full card glass-sheet overflow-hidden flex flex-col max-h-[92vh]", sizes[size], className)}
          >
            {(title || description) && (
              <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
                <div>
                  {title && <h2 className="text-base font-semibold">{title}</h2>}
                  {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
                </div>
                <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><X className="h-4 w-4" /></button>
              </div>
            )}
            <div className="overflow-y-auto scrollbar-thin px-5 py-4 flex-1">{children}</div>
            {footer && <div className="border-t border-ink-100 px-5 py-3 flex items-center justify-end gap-2 bg-ink-50">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
    </Portal>
  );
}

/** Right-hand slide-over drawer. */
export function Drawer({ open, onClose, title, children, width = "max-w-2xl", footer }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; width?: string; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <Portal>
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true">
          <motion.div className="absolute inset-0 bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className={cn("absolute right-0 top-0 h-full w-full glass-sheet border-y-0 border-r-0 shadow-pop flex flex-col", width)}
          >
            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
              <h2 className="text-base font-semibold">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
            {footer && <div className="border-t border-ink-100 px-5 py-3 flex items-center justify-end gap-2 bg-ink-50">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
    </Portal>
  );
}
