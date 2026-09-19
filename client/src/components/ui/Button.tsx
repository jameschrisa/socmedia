import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 shadow-glow focus-visible:ring-brand-500/40",
  secondary: "bg-brand-100 text-brand-800 hover:bg-brand-200 focus-visible:ring-brand-500/30",
  outline: "glass-veil text-ink-800 hover:bg-glass-strong hover:border-ink-300 focus-visible:ring-brand-500/30",
  ghost: "text-ink-600 hover:bg-ink-100 focus-visible:ring-brand-500/30",
  danger: "bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-500/40",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-xs gap-1 rounded-none",
  sm: "h-8 px-3.5 text-sm gap-1.5 rounded-none",
  md: "h-9 px-4 text-sm gap-2 rounded-none",
  lg: "h-11 px-6 text-base gap-2 rounded-none",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, icon, children, disabled, ...props }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:pointer-events-none select-none",
        variants[variant], sizes[size], className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
