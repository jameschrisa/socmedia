import { useEffect, useRef, useState, type ReactNode } from "react";
import { useThemeMode } from "@/hooks/useThemeMode";
import { SparkMark, Wordmark } from "@/components/ui";

/** Full-bleed looping background clip behind the sign-in card. Falls back to the poster frame
 * only (no video element at all) when the user prefers reduced motion, and pauses while the
 * tab is hidden so it doesn't burn battery in a background tab. */
function AuthBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = () => setReducedMotion(mq.matches);
    mq.addEventListener?.("change", listener);
    return () => mq.removeEventListener?.("change", listener);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const onVisibility = () => {
      const el = videoRef.current;
      if (!el) return;
      if (document.hidden) el.pause();
      else el.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [reducedMotion]);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden>
      {reducedMotion ? (
        <img src="/media/login-bg.jpg" alt="" className="h-full w-full object-cover" />
      ) : (
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/media/login-bg.jpg"
        >
          <source src="/media/login-bg.mp4" type="video/mp4" />
        </video>
      )}
      {/* Dark glass scrim so the card stays readable over the footage in both themes. */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, rgba(5,6,12,0.32) 0%, rgba(5,6,12,0.52) 55%, rgba(5,6,12,0.74) 100%)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
      />
    </div>
  );
}

/** Shared shell for every screen a signed-out visitor can reach (sign-in, request access):
 * the looping background, the one rounded surface in the product, and the F3i lockup. */
export function AuthShell({ children }: { children: ReactNode }) {
  // These pages render outside AppShell, so each applies the stored theme itself.
  useThemeMode();
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4">
      <AuthBackground />
      <div className="login-card relative z-10 w-full max-w-sm p-8 space-y-6 drift-in" data-testid="login-card">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <SparkMark size={26} className="login-mark" />
            <Wordmark size="lg" />
          </div>
          <p className="login-caption">powered by F3i</p>
        </div>
        {children}
      </div>
    </div>
  );
}
