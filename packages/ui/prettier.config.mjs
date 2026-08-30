import base from "../../prettier.config.mjs";

/**
 * Extends the root config with Tailwind v4 class sorting.
 *
 * This package has no complete Tailwind entry point of its own — `src/styles/theme.css`
 * is a partial, consumed by each app's globals.css AFTER that app's own `@import
 * "tailwindcss"` (see the file's own header comment). The sorter needs a stylesheet that
 * actually contains the real `@import "tailwindcss"` plus the resolved theme (custom
 * fonts/colours affect sort order), so this points at one of the two apps that share the
 * same theme layer — either would sort identically for anything defined in
 * `@schoolhub/ui/styles/theme.css`, which is everything this package's own components use.
 */
export default {
  ...base,
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "../../apps/dashboard/src/app/globals.css",
};
