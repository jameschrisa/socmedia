/** @type {import('tailwindcss').Config} */
// Modern Glass palette driven by CSS variables (see src/styles.css) so dark and light modes share one token set.
// Primary accent is Glow Cyan; coral is reserved for destructive/failed states.
const v = (name) => `var(--c-${name})`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        surface: v("surface"),
        stage: "#3d4159",
        glass: { DEFAULT: v("glass-panel"), veil: v("glass-veil"), panel: v("glass-panel"), sheet: v("glass-sheet"), strong: v("glass-strong") },
        ink: {
          900: v("ink-900"), 800: v("ink-800"), 700: v("ink-700"), 600: v("ink-600"), 500: v("ink-500"), 400: v("ink-400"),
          300: v("ink-300"), 200: v("ink-200"), 100: v("ink-100"), 50: v("ink-50"),
        },
        brand: {
          50: v("brand-50"), 100: v("brand-100"), 200: v("brand-200"), 300: v("brand-300"), 400: v("brand-400"),
          500: v("brand-500"), 600: v("brand-600"), 700: v("brand-700"), 800: v("brand-800"), 900: v("brand-900"),
        },
        ember: "#e89a45",
        crimson: "#ff3b4e",
        orchid: "#c86bd9",
        cyan: { DEFAULT: "#59d8e6", 400: "#59d8e6", 500: "#59d8e6" },
        mint: "#6fd3a5",
        success: "#6fd3a5",
        green: { 50: v("green-50"), 100: v("green-100"), 200: v("green-200"), 400: "#6fd3a5", 500: "#6fd3a5", 600: v("green-fg"), 700: v("green-fg"), 800: v("green-fg") },
        amber: { 50: v("amber-50"), 100: v("amber-100"), 200: v("amber-200"), 400: "#e89a45", 500: "#e89a45", 600: v("amber-fg"), 700: v("amber-fg"), 800: v("amber-fg") },
        orange: { 50: v("amber-50"), 100: v("amber-100"), 500: "#e89a45", 600: v("amber-fg") },
        red: { 50: v("red-50"), 100: v("red-100"), 200: v("red-200"), 500: "#ff3b4e", 600: v("red-fg"), 700: v("red-fg"), 800: v("red-fg") },
        sky: { 50: v("sky-50"), 100: v("sky-100"), 500: "#59d8e6", 600: v("sky-fg"), 700: v("sky-fg"), 800: v("sky-fg") },
        pink: { 50: v("pink-50"), 100: v("pink-100"), 500: "#c86bd9", 600: v("pink-fg"), 700: v("pink-fg") },
        purple: { 50: v("pink-50"), 500: "#c86bd9", 600: v("pink-fg") },
      },
      boxShadow: {
        card: "var(--sh-card)",
        pop: "var(--sh-pop)",
        glow: "0 0 24px rgba(89,216,230,0.35)",
      },
      // Square corners everywhere except `rounded-full`, which is reserved for badges, tags, dots and toggles.
      borderRadius: { none: "0", sm: "0", DEFAULT: "0", md: "0", lg: "0", xl: "0", "2xl": "0", "3xl": "0", xl2: "0", card: "0", row: "0", full: "9999px" },
      fontFamily: {
        sans: ["Outfit", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      keyframes: {
        shimmer: { "0%": { backgroundPosition: "-400px 0" }, "100%": { backgroundPosition: "400px 0" } },
        // Final keyframes reset transform/filter to none so animated wrappers stop acting as containing blocks for fixed children (modals).
        drift: { "0%": { opacity: "0", filter: "blur(8px)", transform: "translateY(14px)" }, "99%": { opacity: "1", filter: "blur(0)", transform: "translateY(0)" }, "100%": { opacity: "1", filter: "none", transform: "none" } },
        settle: { "0%": { opacity: "0", transform: "translateY(26px) scale(0.97)" }, "80%": { transform: "translateY(-3px) scale(1)" }, "99%": { opacity: "1", transform: "translateY(0) scale(1)" }, "100%": { opacity: "1", transform: "none" } },
      },
      animation: { shimmer: "shimmer 1.4s linear infinite", drift: "drift 650ms cubic-bezier(0.22,0.61,0.36,1) forwards", settle: "settle 500ms cubic-bezier(0.22,0.61,0.36,1) forwards" },
    },
  },
  plugins: [],
};
