import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0fdf4",
          100: "#dcfce7",
          500: "#16a34a",
          600: "#15803d",
          700: "#166534",
        },
      },
      fontSize: {
        // Larger defaults for the non-technical cashier on a phone.
        base: ["1.0625rem", { lineHeight: "1.6" }],
      },
    },
  },
  plugins: [],
};

export default config;
