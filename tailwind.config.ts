import type { Config } from "tailwindcss";

export default {
  theme: {
    extend: {
      fontFamily: {
        display: ["DM Sans", "sans-serif"],
        body: ["DM Sans", "sans-serif"],
      },
      colors: {
        ink: "#1e3a8a",
        pine: "#3b82f6",
        mist: "#eff6ff",
        clay: "#c84d3d",
        // Flowbite components (Button/Input/Select/Checkbox) theme their focus rings
        // and checked states with `primary-*`, so the scale must be defined for them
        // to render. Mapped to Tailwind blue to match the app's accent.
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
      },
      boxShadow: {
        panel: "0 10px 30px rgba(30, 64, 175, 0.1)",
      },
    },
  },
} satisfies Config;