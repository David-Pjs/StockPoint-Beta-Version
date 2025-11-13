/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#059669",      // Emerald main
        primaryDark: "#047857",  // Hover shade
        accent: "#34D399",       // Success highlight
        background: "#0F172A",   // Dark background
        card: "#1E293B",         // Card panels
        ink: "#F1F5F9",          // Text
        muted: "#94A3B8",        // Subtle text
        ok: "#10B981",           // Positive
        bad: "#EF4444",          // Errors
      },
    },
  },
  plugins: [],
};
