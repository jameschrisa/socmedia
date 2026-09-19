/** @type {import('tailwindcss').Config} */
// Modern Glass palette: near-black blue-leaning grounds, frosted white glass, ink text, one coral signal.
const glass = (a) => `rgba(255, 255, 255, ${a})`;
const tint = (rgb, a) => `rgba(${rgb}, ${a})`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0d0f16",   // Void: app ground
        surface: "#14161f",  // raised dark
        stage: "#3d4159",
        glass: { DEFAULT: glass(0.07), veil: glass(0.05), panel: glass(0.07), sheet: glass(0.10), strong: glass(0.14) },
        // Ink scale inverted for dark grounds: 900 is the brightest text, 50 the faintest fill.
        ink: {
          900: "#f0eef3", 800: "#dcdae6", 700: "#c9c7d4", 600: "#b5b3c2", 500: "#a5a3b2", 400: "#7a7987",
          300: glass(0.18), 200: glass(0.12), 100: glass(0.07), 50: glass(0.05),
        },
        // Signal coral is the brand/primary accent.
        brand: {
          50: tint("224,82,78", 0.10), 100: tint("224,82,78", 0.18), 200: tint("224,82,78", 0.32), 300: "#f08a86", 400: "#e86d69",
          500: "#e0524e", 600: "#cf4743", 700: "#f4a3a0", 800: "#f7bcb9", 900: "#fbd9d7",
        },
        // Expanded accent palette (imagery hues used sparingly for state).
        ember: "#e89a45",
        crimson: "#ff3b4e",
        orchid: "#c86bd9",
        cyan: { DEFAULT: "#59d8e6", 400: "#59d8e6", 500: "#59d8e6" },
        mint: "#6fd3a5",
        success: "#6fd3a5",
        // Remap Tailwind status palettes so existing badge/tone classes read well on dark glass.
        green: { 50: tint("111,211,165", 0.14), 100: tint("111,211,165", 0.22), 200: tint("111,211,165", 0.35), 400: "#6fd3a5", 500: "#6fd3a5", 600: "#8fe0bb", 700: "#a9e9cb", 800: "#c4f1dc" },
        amber: { 50: tint("232,154,69", 0.14), 100: tint("232,154,69", 0.22), 200: tint("232,154,69", 0.35), 400: "#e89a45", 500: "#e89a45", 600: "#f0b46f", 700: "#f4c690", 800: "#f8d9b3" },
        orange: { 50: tint("232,154,69", 0.14), 100: tint("232,154,69", 0.22), 500: "#e89a45", 600: "#f0b46f" },
        red: { 50: tint("255,59,78", 0.14), 100: tint("255,59,78", 0.22), 200: tint("255,59,78", 0.35), 500: "#ff3b4e", 600: "#ff6b7a", 700: "#ff8f9a", 800: "#ffb3bb" },
        sky: { 50: tint("89,216,230", 0.14), 100: tint("89,216,230", 0.22), 500: "#59d8e6", 600: "#59d8e6", 700: "#8ae4ee", 800: "#b0edf4" },
        pink: { 50: tint("200,107,217", 0.14), 100: tint("200,107,217", 0.22), 500: "#c86bd9", 600: "#d58ae2", 700: "#e0a6ea" },
        purple: { 50: tint("200,107,217", 0.14), 500: "#c86bd9", 600: "#d58ae2" },
      },
      boxShadow: {
        card: "inset 0 1px 0 rgba(255,255,255,0.10), 0 18px 48px rgba(5,6,12,0.50)",
        pop: "inset 0 1px 0 rgba(255,255,255,0.12), 0 24px 64px rgba(5,6,12,0.65)",
        glow: "0 0 24px rgba(224,82,78,0.35)",
      },
      // Square corners everywhere except `rounded-full`, which is reserved for badges, tags, dots and toggles.
      borderRadius: { none: "0", sm: "0", DEFAULT: "0", md: "0", lg: "0", xl: "0", "2xl": "0", "3xl": "0", xl2: "0", card: "0", row: "0", full: "9999px" },
      fontFamily: {
        sans: ["Outfit", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Playfair Display", "Georgia", "serif"],
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
