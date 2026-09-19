import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  label?: string;
  className?: string;
}

/** iOS-style switch, green when on like the reference design. */
export function Toggle({ checked, onChange, disabled, size = "md", label, className }: ToggleProps) {
  const w = size === "sm" ? "w-9 h-5" : "w-11 h-6";
  const knob = size === "sm" ? 16 : 20;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
        w, checked ? "bg-success" : "bg-ink-300", disabled && "opacity-50 cursor-not-allowed", className,
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 600, damping: 32 }}
        className="block rounded-full bg-ink-900 shadow"
        style={{ width: knob, height: knob, marginLeft: checked ? "auto" : 0 }}
      />
    </button>
  );
}
