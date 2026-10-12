/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        student: {
          background: "var(--student-background, #fbf9f8)",
          surface: "var(--student-surface, #ffffff)",
          muted: "var(--student-muted, #f5f3f3)",
          text: "var(--student-text, #1b1c1c)",
          secondary: "var(--student-secondary, #3e4946)",
          primary: "var(--student-primary, #00695b)",
          success: "var(--student-success, #005045)",
          action: "var(--student-action, #246259)",
          actionPressed: "var(--student-action-pressed, #17483f)",
          successSurface: "var(--student-success-surface, #e8f4f1)",
          outline: "var(--student-outline, #56625d)",
          border: "var(--student-border, #68736f)",
          error: "var(--student-error, #ba1a1a)",
          errorSurface: "var(--student-error-surface, #fcebec)",
          focus: "var(--student-focus, #2563eb)",
          warning: "var(--student-warning, #704000)",
          warningSurface: "var(--student-warning-surface, #fff3d8)",
        },
      },
      fontSize: {
        xs: ["var(--ceretime-font-xs, 12px)", { lineHeight: "var(--ceretime-line-xs, 16px)" }],
        sm: ["var(--ceretime-font-sm, 14px)", { lineHeight: "var(--ceretime-line-sm, 20px)" }],
        base: [
          "var(--ceretime-font-base, 16px)",
          { lineHeight: "var(--ceretime-line-base, 24px)" },
        ],
        lg: ["var(--ceretime-font-lg, 18px)", { lineHeight: "var(--ceretime-line-lg, 28px)" }],
        xl: ["var(--ceretime-font-xl, 20px)", { lineHeight: "var(--ceretime-line-xl, 28px)" }],
        "2xl": ["var(--ceretime-font-2xl, 24px)", { lineHeight: "var(--ceretime-line-2xl, 32px)" }],
        "3xl": ["var(--ceretime-font-3xl, 30px)", { lineHeight: "var(--ceretime-line-3xl, 36px)" }],
        "4xl": ["var(--ceretime-font-4xl, 36px)", { lineHeight: "var(--ceretime-line-4xl, 40px)" }],
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      const scaledLineHeights = Object.fromEntries(
        [20, 25, 26, 28, 29, 34, 37].map((size) => [
          `.leading-\\[${size}px\\]`,
          { lineHeight: `var(--ceretime-line-${size}, ${size}px)` },
        ]),
      );
      addUtilities(scaledLineHeights);
      addUtilities({
        ".text-\\[28px\\]": {
          fontSize: "var(--ceretime-font-28, 28px)",
          lineHeight: "var(--ceretime-line-37, 37px)",
        },
      });
    },
  ],
};
