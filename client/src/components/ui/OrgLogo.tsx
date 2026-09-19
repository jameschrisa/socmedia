import type { Organization } from "@socmedia/shared";
import { cn, initials } from "@/lib/utils";

/** Organization avatar: the uploaded logo filling a white tile when present (bundled marks carry their own background; dark marks on transparent uploads stay visible in dark mode), otherwise initials on the brand colour. */
export function OrgLogo({ org, size = 32, className, rounded = "rounded-lg" }: { org: Pick<Organization, "name" | "brandColor" | "logoUrl">; size?: number; className?: string; rounded?: string }) {
  if (org.logoUrl) {
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden border border-ink-200 bg-white", rounded, className)} style={{ width: size, height: size }} data-testid="org-logo">
        <img src={org.logoUrl} alt={`${org.name} logo`} className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center font-bold text-white", rounded, className)} style={{ width: size, height: size, background: org.brandColor, fontSize: Math.max(10, size * 0.38) }} data-testid="org-initials" aria-hidden>
      {initials(org.name)}
    </span>
  );
}
