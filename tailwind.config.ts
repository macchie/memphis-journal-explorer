import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,html}"],
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
      },
      boxShadow: {
        panel: "0 10px 30px rgba(30, 64, 175, 0.1)",
      },
    },
  },
  plugins: [],
} satisfies Config;