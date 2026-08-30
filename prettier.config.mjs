/**
 * Root Prettier config. Explicit values rather than defaults, so the style is reviewable
 * and stable across Prettier majors — matches the line budget ESLint/ruff already use.
 *
 * apps/dashboard and apps/website each add their own `prettier.config.mjs` on top of this
 * (Tailwind v4 is CSS-first, so `prettier-plugin-tailwindcss` needs each app's own CSS
 * entry point — there is no single shared stylesheet to point at from here).
 */
/** @type {import("prettier").Config} */
const config = {
  printWidth: 100,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
};

export default config;
